import { randomUUID } from "node:crypto";
import {
  AnswerSchema,
  RunIdSchema,
  RunViewSchema,
  StepKeySchema,
  type Answer,
  type Change,
  type Coverage,
  type Cv,
  type ExitReason,
  type JobProfile,
  type Question,
  type RequirementId,
  type RunErrorCode,
  type RunId,
  type StepState,
  type UserEvidence,
  type RunView,
} from "@resume-ai/shared";
import { applyChanges } from "@/tailoring/applyChanges.js";
import type { RecordedRejection } from "@/tailoring/validateChanges.js";
import { MAX_ROUNDS } from "@/scoring/exitRouter.js";
import { CoverageError } from "@/scoring/errors.js";
import { describeFailure } from "@/llm/llmClient.js";
import { ExtractionError, NoRequirementsError } from "@/extraction/errors.js";
import type { Config } from "@/utils/config.js";
import { ApiError } from "@/utils/errors.js";
import { withSessionSpan } from "@/utils/spans.js";
import { parseCv, stripNul } from "@/parsing/parseCv.js";
import type { RunStore, StoredRun } from "@/stores/runs.js";

/** What the service sees of a Run's graph state: plain data typed with shared types. */
export type RunSnapshot = {
  jobProfile: JobProfile | null;
  cv: Cv | null;
  coverageBefore: Coverage[] | null;
  coverage: Coverage[] | null;
  changes: Change[];
  /** Unrounded Match Scores, before tailoring and after the last kept round. */
  scoreBefore: number | null;
  scoreAfter: number | null;
  /** Changes rejected by stage 1 or the claim check, across rounds. */
  rejections: RecordedRejection[];
  /** The Questions asked after the first Coverage (empty when there was nothing to ask), and what the Answers recorded. */
  questions: Question[];
  userEvidence: UserEvidence[];
  confirmedGaps: RequirementId[];
  /** Tailoring rounds started. */
  rounds: number;
  exitReason: ExitReason | null;
};

export type StartRunInput = { runId: RunId; cvText: string; jobDescriptionText: string };

/**
 * Runs a Run's workflow and reads its state back. Defined here so the service never sees LangGraph; `graph/`
 * implements it. It keeps the Run's `status` in step with the node it is in, and rejects with the original
 * error when the workflow fails before the first score.
 */
export interface GraphRunner {
  /** Runs until the workflow pauses for review, and returns the state it paused with. */
  start(input: StartRunInput): Promise<RunSnapshot>;
  /**
   * Resumes a Run paused for Answers (already validated by the caller) and runs until the next pause, like `start`;
   * the post-resume work is a new root span with the same session id. Rejects with the original error on failure.
   */
  answer(runId: RunId, answers: Answer[]): Promise<RunSnapshot>;
  /** The current state, or null when no checkpoint exists yet. */
  read(runId: RunId): Promise<RunSnapshot | null>;
}

/**
 * An in-process bus that tells listeners a Run changed. It carries only the Run id, never Run data: each listener
 * rebuilds the view itself. Defined here so the service and the graph runner depend on the shape, not on an emitter.
 */
export interface RunEvents {
  /** Tells every listener of the Run that something may have changed. A throwing listener never reaches the caller. */
  publish(runId: RunId): void;
  /** Calls `listener` on each `publish` of the Run until the returned function is called. */
  subscribe(runId: RunId, listener: () => void): () => void;
}

export type RunsDeps = {
  store: RunStore;
  config: Config;
  graphRunner: GraphRunner;
  events: RunEvents;
  now?: () => Date;
  /** Starts a task without awaiting it. Tests pass a version that collects the promises. */
  runInBackground?: (task: () => Promise<void>) => void;
};

/** Fire and forget: a rejection is logged so it can never become an unhandled rejection. */
function defaultRunInBackground(task: () => Promise<void>): void {
  task().catch((error: unknown) => console.error("Background task failed", error));
}

/** User-facing failure messages (plan, "Failure codes"). The real cause is logged, never shown. */
const FAILURE_MESSAGES: Record<Extract<RunErrorCode, "EXTRACTION_FAILED" | "NO_REQUIREMENTS" | "COVERAGE_FAILED" | "INTERNAL">, string> = {
  EXTRACTION_FAILED: "We couldn't read the structure of your CV or job description. Try again, or upload a DOCX.",
  NO_REQUIREMENTS: "We couldn't find any requirements in this job description. Paste the full posting.",
  COVERAGE_FAILED: "We couldn't assess your CV against this job. Try again.",
  INTERNAL: "Something went wrong. Try again.",
};

function failureCode(error: unknown): keyof typeof FAILURE_MESSAGES {
  if (error instanceof NoRequirementsError) return "NO_REQUIREMENTS";
  if (error instanceof ExtractionError) return "EXTRACTION_FAILED";
  if (error instanceof CoverageError) return "COVERAGE_FAILED";
  return "INTERNAL";
}

/** The statuses where nothing happens without the user: a stream closes after sending one. */
const RESTING_STATUSES: ReadonlySet<RunView["status"]> = new Set(["awaiting_answers", "awaiting_review", "failed", "interrupted", "completed"]);

/** What a client connection gives `openRunStream`: `send` writes one view, `close` ends the stream. */
export type RunStreamSink = { send: (view: RunView) => void; close: () => void };

/** The longest `has_experience` text, after trimming. */
export const MAX_ANSWER_LENGTH = 1000;

export type CreateRunInput = { cv: Buffer; jobDescription: unknown };

/** The business rules for a Run. It knows nothing about HTTP. */
export class RunsService {
  private readonly now: () => Date;
  private readonly runInBackground: (task: () => Promise<void>) => void;

  constructor(private readonly deps: RunsDeps) {
    this.now = deps.now ?? (() => new Date());
    this.runInBackground = deps.runInBackground ?? defaultRunInBackground;
  }

  /** Validates and parses the upload, then stores the Run. Throws an `ApiError` when the upload is rejected. */
  async createRun({ cv, jobDescription }: CreateRunInput): Promise<RunId> {
    const { store, config } = this.deps;
    const jobDescriptionText = typeof jobDescription === "string" ? stripNul(jobDescription).trim() : "";
    if (!jobDescriptionText) throw new ApiError("BAD_REQUEST", "The `jobDescription` field is required.");
    if (jobDescriptionText.length > config.limits.maxJobDescriptionChars) {
      throw new ApiError("JOB_DESCRIPTION_TOO_LONG", `The job description is longer than ${config.limits.maxJobDescriptionChars} characters.`);
    }

    const cvText = await parseCv(cv, config.limits);
    // Both timestamps come from one clock, so a Run lives exactly RUN_TTL_DAYS.
    const createdAt = this.now();
    const run = await store.create({
      id: RunIdSchema.parse(randomUUID()),
      status: "extracting",
      createdAt,
      expiresAt: new Date(createdAt.getTime() + config.runTtlMs),
    });
    this.runInBackground(() => this.runPipeline({ runId: run.id, cvText, jobDescriptionText }));
    return run.id;
  }

  /**
   * The background pipeline: hands the texts to the graph runner, which extracts, assesses Coverage and pauses for
   * review, writing the status as it goes; or records the failure on the Run. It runs under one `pipeline` root
   * span (`session.id` = the Run id) that ends with the scores, the rounds and the exit reason, never content.
   * It never throws: it runs detached from the request, so a failure has nowhere else to go.
   */
  async runPipeline(input: StartRunInput): Promise<void> {
    const { graphRunner } = this.deps;
    const id = input.runId;
    try {
      try {
        await withSessionSpan("pipeline", id, async (span) => {
          const result = await graphRunner.start(input);
          if (result.scoreBefore !== null) span.setAttribute("score.before", result.scoreBefore);
          if (result.scoreAfter !== null) span.setAttribute("score.after", result.scoreAfter);
          span.setAttribute("rounds", result.rounds);
          if (result.exitReason !== null) span.setAttribute("exit_reason", result.exitReason);
        });
      } catch (error) {
        await this.recordFailure(id, "pipeline", error);
      }
    } catch (error) {
      console.error(`Run ${id}: could not store the pipeline outcome`, error);
    }
  }

  /**
   * Accepts the Answers for a Run paused in `awaiting_answers` and resumes it in the background. Checks, in order:
   * the Run exists (404), it is waiting for Answers (409), the Answers are valid (400). Only then does it claim the
   * Run by moving it to `tailoring` (the status the resumed graph writes first anyway) in one conditional update, so
   * a second submission, even a simultaneous one, finds it no longer waiting and gets 409 without resuming twice.
   */
  async submitAnswers(rawId: string, body: unknown): Promise<void> {
    const { store, graphRunner } = this.deps;
    const id = RunIdSchema.safeParse(rawId);
    const run = id.success ? await store.get(id.data) : null;
    if (!run || run.expiresAt <= this.now()) throw new ApiError("RUN_NOT_FOUND", "Run not found.");
    if (run.status !== "awaiting_answers") throw new ApiError("RUN_NOT_AWAITING_ANSWERS", "This Run is not waiting for answers.");

    const questions = (await graphRunner.read(run.id))?.questions ?? [];
    const answers = validateAnswers(body, new Set(questions.map((q) => q.id as string)));
    if (!(await store.claimStatus(run.id, "awaiting_answers", "tailoring"))) {
      throw new ApiError("RUN_NOT_AWAITING_ANSWERS", "This Run is not waiting for answers.");
    }
    this.deps.events.publish(run.id);
    this.runInBackground(() => this.runResume(run.id, answers));
  }

  /** Logs a failed background step and marks the Run failed with the matching code and message. */
  private async recordFailure(id: RunId, label: "pipeline" | "resume", error: unknown): Promise<void> {
    const code: RunErrorCode = failureCode(error);
    // Log the code, the error name (with status and code for LLM failures) and the issue count only. Messages and issues can quote CV values or
    // model output, so they are not logged here (known open item: a safe failure log).
    const name = describeFailure(error);
    const issues = (error as { issues?: unknown } | null)?.issues;
    const count = Array.isArray(issues) ? `, ${issues.length} issues` : "";
    console.error(`Run ${id}: ${label} failed (${code}) ${name}${count}`);
    await this.deps.store.markFailed(id, code, FAILURE_MESSAGES[code]);
    this.deps.events.publish(id);
  }

  /** The background resume: the graph runs on from the Answers to the next pause, or the failure is recorded on the Run. Never throws. */
  async runResume(id: RunId, answers: Answer[]): Promise<void> {
    const { graphRunner } = this.deps;
    try {
      try {
        await graphRunner.answer(id, answers);
      } catch (error) {
        await this.recordFailure(id, "resume", error);
      }
    } catch (error) {
      console.error(`Run ${id}: could not store the resume outcome`, error);
    }
  }

  /**
   * A malformed, unknown or expired ID all look the same, so an ID reveals nothing about whether it ever existed.
   * Expiry is checked on read; the slice 5 sweep is only cleanup.
   */
  async getRunView(rawId: string): Promise<RunView> {
    const id = RunIdSchema.safeParse(rawId);
    const run = id.success ? await this.deps.store.get(id.data) : null;
    if (!run || run.expiresAt <= this.now()) throw new ApiError("RUN_NOT_FOUND", "Run not found.");
    // A Run with no checkpoint yet (the graph has not started) reads as null.
    return toRunView(run, await this.deps.graphRunner.read(run.id));
  }

  /**
   * Follows a Run: sends its current view, then a new view after every change, and closes after a view whose status
   * needs the user (or the Run is gone). A view identical to the last one sent is skipped, and rebuilds are serialised
   * so views go out in order. It subscribes before reading the first view, so a change in between is not lost.
   * Throws the same 404 as `getRunView` before anything is sent; returns the function that ends the subscription.
   */
  async openRunStream(rawId: string, { send, close }: RunStreamSink): Promise<() => void> {
    const parsed = RunIdSchema.safeParse(rawId);
    if (!parsed.success) throw new ApiError("RUN_NOT_FOUND", "Run not found.");
    const id = parsed.data;
    let done = false;
    let lastSent: string | null = null;
    let unsubscribe = () => {};
    const stop = () => {
      done = true;
      unsubscribe();
    };

    /** Builds the view and sends it unless it equals the last one. Rejects when the view cannot be built. */
    const emit = async (): Promise<void> => {
      if (done) return;
      const view = await this.getRunView(id);
      if (done) return;
      const json = JSON.stringify(view);
      if (json === lastSent) return;
      lastSent = json;
      send(view);
      if (RESTING_STATUSES.has(view.status)) {
        stop();
        close();
      }
    };

    let chain: Promise<void> = Promise.resolve();
    unsubscribe = this.deps.events.subscribe(id, () => {
      chain = chain.then(emit).catch((error: unknown) => {
        // The Run expired or its view could not be built: there is nothing more to follow.
        if (!(error instanceof ApiError)) console.error(`Run ${id}: stream rebuild failed`, error);
        stop();
        close();
      });
    });
    try {
      await emit();
    } catch (error) {
      stop();
      throw error;
    }
    return stop;
  }
}

/**
 * Checks the body of an answers request and returns the Answers with their text trimmed. Rejects anything but a list
 * of valid Answers to the given Questions, each at most once. The messages never echo the text.
 */
function validateAnswers(body: unknown, questionIds: Set<string>): Answer[] {
  const invalid = (message: string) => new ApiError("INVALID_ANSWERS", message);
  const list = (body as { answers?: unknown } | null | undefined)?.answers;
  if (!Array.isArray(list)) throw invalid("Send `answers` as a list.");
  const seen = new Set<string>();
  return list.map((raw, i) => {
    const parsed = AnswerSchema.safeParse(raw);
    if (!parsed.success) throw invalid(`Answer ${i + 1} is not valid.`);
    const answer: Answer = parsed.data.kind === "has_experience" ? { ...parsed.data, text: parsed.data.text.trim() } : parsed.data;
    if (answer.kind === "has_experience" && (answer.text === "" || answer.text.length > MAX_ANSWER_LENGTH)) {
      throw invalid(`Answer ${i + 1} must be between 1 and ${MAX_ANSWER_LENGTH} characters.`);
    }
    if (!questionIds.has(answer.questionId)) throw invalid(`Answer ${i + 1} is for a question this Run did not ask.`);
    if (seen.has(answer.questionId)) throw invalid(`Answer ${i + 1} repeats a question already answered.`);
    seen.add(answer.questionId);
    return answer;
  });
}

/**
 * Derives the view from the `runs` row (status, error, timestamps) and the graph state (everything else).
 * A failed Run marks the step that broke as `failed`: `coverage` when the extraction results exist, otherwise
 * `extract`. Scores are rounded here for display. Validating against the schema keeps the response honest.
 */
function toRunView(run: StoredRun, state: RunSnapshot | null): RunView {
  const common = {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    expiresAt: run.expiresAt.toISOString(),
  };
  const { cv, jobProfile } = state ?? { cv: null, jobProfile: null };
  const extracted = cv !== null && jobProfile !== null;
  const job = jobProfile ? { title: jobProfile.title, company: jobProfile.company } : null;
  const steps = (states: Partial<Record<(typeof StepKeySchema.options)[number], StepState>>) =>
    StepKeySchema.options.map((key) => ({ key, state: states[key] ?? "pending" }));

  if (run.status === "failed" && run.error) {
    return RunViewSchema.parse({
      ...common,
      status: "failed",
      job,
      steps: extracted ? steps({ parse: "done", extract: "done", coverage: "failed" }) : steps({ parse: "done", extract: "failed" }),
      error: run.error,
    });
  }
  if (run.status === "awaiting_review" && cv && jobProfile && state?.coverageBefore && state.coverage && state.scoreBefore !== null && state.scoreAfter !== null && state.exitReason) {
    const verdict = (coverage: Coverage[], id: string) => coverage.find((c) => c.requirementId === id);
    return RunViewSchema.parse({
      ...common,
      status: "awaiting_review",
      job,
      steps: steps({ parse: "done", extract: "done", coverage: "done", questions: "done", tailor: "done", review: "running" }),
      score: { before: Math.round(state.scoreBefore), after: Math.round(state.scoreAfter) },
      requirements: jobProfile.requirements.map((requirement) => {
        const before = verdict(state.coverageBefore!, requirement.id);
        const after = verdict(state.coverage!, requirement.id);
        return {
          id: requirement.id,
          text: requirement.text,
          importance: requirement.importance,
          before: before?.verdict ?? "unmet",
          after: { verdict: after?.verdict ?? "unmet", evidenceIds: after?.evidenceIds ?? [], reason: after?.reason ?? "" },
          confirmedGap: state.confirmedGaps.includes(requirement.id),
        };
      }),
      // The Tailored CV: the original plus the kept Changes.
      cv: applyChanges(cv, state.changes),
      changes: state.changes,
      userEvidence: state.userEvidence,
      iterations: { used: state.rounds, max: MAX_ROUNDS },
      exitReason: state.exitReason,
    });
  }
  if (run.status === "awaiting_answers" && extracted && state) {
    return RunViewSchema.parse({
      ...common,
      status: "awaiting_answers",
      job,
      steps: steps({ parse: "done", extract: "done", coverage: "done", questions: "running" }),
      questions: state.questions,
    });
  }
  if (run.status === "tailoring" && extracted && state) {
    return RunViewSchema.parse({
      ...common,
      status: "tailoring",
      job,
      steps: steps({ parse: "done", extract: "done", coverage: "done", questions: "done", tailor: "running" }),
      iterations: { used: state.rounds, max: MAX_ROUNDS },
      score: { before: Math.round(state.scoreBefore ?? 0), after: state.scoreAfter === null || state.changes.length === 0 ? null : Math.round(state.scoreAfter) },
    });
  }
  return RunViewSchema.parse({
    ...common,
    status: "extracting",
    job,
    steps: extracted ? steps({ parse: "done", extract: "done", coverage: "running" }) : steps({ parse: "done", extract: "running" }),
  });
}
