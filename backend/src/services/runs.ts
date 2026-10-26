import { randomUUID } from "node:crypto";
import {
  AnswerSchema,
  ReviewDecisionSchema,
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
  type ReviewDecision,
  type RequirementId,
  type RunErrorCode,
  type RunId,
  type RunStatus,
  type StepState,
  type UserEvidence,
  type RunView,
} from "@resume-ai/shared";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { keptChanges, reviewProblem } from "@/tailoring/review.js";
import type { RecordedRejection } from "@/tailoring/validateChanges.js";
import { MAX_ROUNDS } from "@/scoring/exitRouter.js";
import { CoverageError } from "@/scoring/errors.js";
import { describeFailure } from "@/llm/llmClient.js";
import { ExtractionError, NoRequirementsError } from "@/extraction/errors.js";
import type { Config } from "@/utils/config.js";
import { ApiError } from "@/utils/errors.js";
import { withSessionSpan, type Span } from "@/utils/spans.js";
import { parseCv, stripNul } from "@/parsing/parseCv.js";
import type { RunStore, StoredRun } from "@/stores/runs.js";

/** What the service sees of a Run's graph state: plain data typed with shared types. */
export type RunSnapshot = {
  /**
   * Where the graph is (`graph/position.ts`): waiting for Answers, waiting for review, ended, or `null` while a node is
   * due to run. The only reading of the graph's position; nothing else decides a Pause or the end.
   */
  position: "answers" | "review" | "ended" | null;
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
  /**
   * Carries on a Run from its last checkpoint with no new input, after the process that was running it stopped, and
   * runs until the next pause or the end, like `start`. Rejects with the original error on failure.
   */
  recover(runId: RunId): Promise<RunSnapshot>;
  /**
   * Resumes a Run paused for review with the decisions (already validated by the caller) and runs to the end, where the
   * runner writes `completed`; the post-resume work is a new root span with the same session id. Rejects with the original error on failure.
   */
  review(runId: RunId, decisions: ReviewDecision[]): Promise<RunSnapshot>;
  /** The current state, or null when no checkpoint exists yet. */
  read(runId: RunId): Promise<RunSnapshot | null>;
  /** Removes every checkpoint stored for the Run. Only safe once nothing is running it. */
  deleteThread(runId: RunId): Promise<void>;
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

/** The scores, the rounds and the exit reason on the span that ends a stretch of a Run, never content. */
function setOutcomeAttributes(span: Span, result: RunSnapshot): void {
  if (result.scoreBefore !== null) span.setAttribute("score.before", result.scoreBefore);
  if (result.scoreAfter !== null) span.setAttribute("score.after", result.scoreAfter);
  span.setAttribute("rounds", result.rounds);
  if (result.exitReason !== null) span.setAttribute("exit_reason", result.exitReason);
}

/** The statuses after which a Run's stream ends: the Run is at a Pause (waiting for the user), Interrupted, failed or completed. */
const STREAM_END_STATUSES: ReadonlySet<RunView["status"]> = new Set(["awaiting_answers", "awaiting_review", "failed", "interrupted", "completed"]);

/** The statuses in which the graph runner may still write checkpoints for the Run. */
const BUSY_STATUSES: RunStatus[] = ["parsing", "extracting", "tailoring"];

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
        await withSessionSpan("pipeline", id, async (span) => setOutcomeAttributes(span, await graphRunner.start(input)));
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

  /**
   * Accepts the Review for a Run paused in `awaiting_review` and resumes it in the background, like `submitAnswers`: 404,
   * 409, then 400 for decisions that do not fit the Run's Changes (`validateReview`, nothing is resumed), then the claim
   * (`awaiting_review` to `tailoring`), where losing a race is a 409.
   */
  async submitReview(rawId: string, body: unknown): Promise<void> {
    const { store, graphRunner } = this.deps;
    const id = RunIdSchema.safeParse(rawId);
    const run = id.success ? await store.get(id.data) : null;
    if (!run || run.expiresAt <= this.now()) throw new ApiError("RUN_NOT_FOUND", "Run not found.");
    if (run.status !== "awaiting_review") throw new ApiError("RUN_NOT_AWAITING_REVIEW", "This Run is not waiting for review.");

    const snapshot = await graphRunner.read(run.id);
    const decisions = validateReview(body, snapshot);
    if (!(await store.claimStatus(run.id, "awaiting_review", "tailoring"))) {
      throw new ApiError("RUN_NOT_AWAITING_REVIEW", "This Run is not waiting for review.");
    }
    this.deps.events.publish(run.id);
    this.runInBackground(() => this.runReview(run.id, decisions));
  }

  /** The background Review: the graph runs on from the decisions to the end, or the failure is recorded on the Run. Never throws. */
  async runReview(id: RunId, decisions: ReviewDecision[]): Promise<void> {
    const { graphRunner } = this.deps;
    try {
      try {
        await withSessionSpan("review", id, async (span) => setOutcomeAttributes(span, await graphRunner.review(id, decisions)));
      } catch (error) {
        await this.recordFailure(id, "review", error);
      }
    } catch (error) {
      console.error(`Run ${id}: could not store the review outcome`, error);
    }
  }

  /** Logs a failed background step and marks the Run failed with the matching code and message. */
  private async recordFailure(id: RunId, label: "pipeline" | "resume" | "review" | "recovery", error: unknown): Promise<void> {
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
   * Carries on the Runs a stop cut off, for the server to call once it is listening. A Run created before this
   * process started (`startedAt`) and still in `extracting` or `tailoring` had its background work in the process
   * that stopped (single instance); a Run created since is being worked on by this process and is left alone. Each is
   * handled from its checkpoint, one at a time to stay within the model provider's rate limits:
   * no checkpoint -> `interrupted`; stopped at a Pause -> that Pause's status; graph ended -> `completed`; mid-graph -> resumed, once (a Run
   * already recovered once becomes `interrupted`, so a Run that crashes the server is not resumed on every restart).
   * Expired Runs and Runs at a Pause are not listed. Never throws: a Run it cannot handle is logged and skipped.
   */
  async recoverRuns(startedAt: Date): Promise<void> {
    let runs: StoredRun[];
    try {
      runs = await this.deps.store.listLive(["extracting", "tailoring"], this.now(), startedAt);
    } catch (error) {
      console.error("Run recovery: could not list the cut-off Runs", error);
      return;
    }
    for (const run of runs) {
      try {
        await this.recoverRun(run);
      } catch (error) {
        console.error(`Run ${run.id}: recovery could not be completed`, error);
      }
    }
  }

  private async recoverRun(run: StoredRun): Promise<void> {
    const { store, graphRunner, events } = this.deps;
    const snapshot = await graphRunner.read(run.id);
    const moveTo = async (status: "awaiting_answers" | "awaiting_review" | "completed" | "interrupted", outcome: string): Promise<void> => {
      // Conditional on the status recovery saw, so a Run a request moved in the meantime is left as it is.
      if (await store.claimStatus(run.id, run.status, status)) {
        console.log(`Run ${run.id}: recovery ${outcome}`);
        events.publish(run.id);
      } else {
        console.log(`Run ${run.id}: recovery skipped, the Run is no longer ${run.status}`);
      }
    };

    if (!snapshot) return moveTo("interrupted", "interrupted (no checkpoint)");
    if (snapshot.position === "ended") return moveTo("completed", "completed (the graph had ended)");
    if (snapshot.position !== null) {
      return moveTo(snapshot.position === "answers" ? "awaiting_answers" : "awaiting_review", "pause restored");
    }
    if (!(await store.claimRecovery(run.id, run.status))) {
      return moveTo("interrupted", "interrupted (already recovered once)");
    }
    console.log(`Run ${run.id}: recovery resumed`);
    try {
      await withSessionSpan("recovery", run.id, async (span) => setOutcomeAttributes(span, await graphRunner.recover(run.id)));
    } catch (error) {
      await this.recordFailure(run.id, "recovery", error);
    }
  }

  /**
   * Deletes a Run: its row, then its checkpoints. 404 for a malformed, unknown, expired or already-deleted ID, 409
   * `RUN_BUSY` while it is `parsing`, `extracting` or `tailoring` (the runner would write checkpoints after the delete),
   * and then nothing is deleted. The row goes first, in one conditional statement, so a simultaneous `POST /answers`
   * either claims the Run first (this gets 409) or finds it gone (that gets 404).
   */
  async deleteRun(rawId: string): Promise<void> {
    const { store } = this.deps;
    const id = RunIdSchema.safeParse(rawId);
    if (!id.success) throw new ApiError("RUN_NOT_FOUND", "Run not found.");
    if (await this.purgeRun(id.data, this.now())) return;
    // Nothing was deleted: re-read to say why.
    const run = await store.get(id.data);
    if (run && run.expiresAt > this.now()) throw new ApiError("RUN_BUSY", "This Run is still working. Try again when it pauses or ends.");
    throw new ApiError("RUN_NOT_FOUND", "Run not found.");
  }

  /**
   * Deletes the Run's row unless it is busy (or, with `liveAt`, expired at that time), then its checkpoints, and says
   * whether the row was deleted. It is the one "delete this Run" operation; the TTL sweep calls it without `liveAt`.
   */
  async purgeRun(id: RunId, liveAt?: Date): Promise<boolean> {
    const { store, graphRunner } = this.deps;
    if (!(await store.deleteUnless(id, BUSY_STATUSES, liveAt))) return false;
    try {
      await graphRunner.deleteThread(id);
    } catch (error) {
      // The row is already gone and the caller's job is done: the sweep removes checkpoint threads that have no Run (ADR 0002).
      console.error(`Run ${id}: could not delete the checkpoints, left for the sweep`, error);
    }
    this.deps.events.publish(id);
    return true;
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
      if (STREAM_END_STATUSES.has(view.status)) {
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
    // The first view goes through the same chain, so a change published while it is being built queues behind it.
    const first = chain.then(emit);
    chain = first.catch(() => {});
    try {
      await first;
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
 * Checks the body of a review request against the Run's Changes and returns the decisions with `after` trimmed. The
 * rules are `reviewProblem`'s; the messages never echo the user's text.
 */
function validateReview(body: unknown, snapshot: RunSnapshot | null): ReviewDecision[] {
  const invalid = (message: string) => new ApiError("INVALID_REVIEW", message);
  const list = (body as { decisions?: unknown } | null | undefined)?.decisions;
  if (!Array.isArray(list)) throw invalid("Send `decisions` as a list.");
  const decisions = list.map((raw, i): ReviewDecision => {
    const parsed = ReviewDecisionSchema.safeParse(raw);
    if (!parsed.success) throw invalid(`Decision ${i + 1} is not valid.`);
    return parsed.data.after === undefined ? parsed.data : { ...parsed.data, after: parsed.data.after.trim() };
  });
  if (!snapshot?.cv) throw invalid("This Run has nothing to review.");
  const problem = reviewProblem(snapshot.cv, snapshot.changes, decisions, snapshot.userEvidence);
  if (problem !== null) throw invalid(problem);
  return decisions;
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
  if ((run.status === "awaiting_review" || run.status === "completed") && cv && jobProfile && state?.coverageBefore && state.coverage && state.scoreBefore !== null && state.scoreAfter !== null && state.exitReason) {
    const verdict = (coverage: Coverage[], id: string) => coverage.find((c) => c.requirementId === id);
    return RunViewSchema.parse({
      ...common,
      status: run.status,
      job,
      steps: steps({ parse: "done", extract: "done", coverage: "done", questions: "done", tailor: "done", review: run.status === "completed" ? "done" : "running" }),
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
      // The Tailored CV: while the user is reviewing, the original plus every proposed Change; once completed, only the accepted and revised ones.
      cv: applyChanges(cv, run.status === "completed" ? keptChanges(state.changes) : state.changes),
      changes: state.changes,
      userEvidence: state.userEvidence,
      iterations: { used: state.rounds, max: MAX_ROUNDS },
      exitReason: state.exitReason,
      ...(run.status === "completed" ? { download: { docx: null, pdf: null } } : {}),
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
      // Once the Review is applied the Changes carry their final statuses: this is the final re-judge, so `review` is running.
      steps: steps(
        state.changes.every((c) => c.status === "proposed")
          ? { parse: "done", extract: "done", coverage: "done", questions: "done", tailor: "running" }
          : { parse: "done", extract: "done", coverage: "done", questions: "done", tailor: "done", review: "running" },
      ),
      iterations: { used: state.rounds, max: MAX_ROUNDS },
      score: { before: Math.round(state.scoreBefore ?? 0), after: state.scoreAfter === null || state.changes.length === 0 ? null : Math.round(state.scoreAfter) },
    });
  }
  if (run.status === "interrupted") {
    // The step that was running when the process stopped: what is missing says which one it was.
    const cutOff = !extracted ? "extract" : state?.scoreBefore == null ? "coverage" : "tailor";
    const order = StepKeySchema.options;
    const reached = order.indexOf(cutOff);
    return RunViewSchema.parse({
      ...common,
      status: "interrupted",
      job,
      steps: steps(Object.fromEntries(order.slice(0, reached + 1).map((key, i) => [key, i === reached ? "failed" : "done"]))),
    });
  }
  return RunViewSchema.parse({
    ...common,
    status: "extracting",
    job,
    steps: extracted ? steps({ parse: "done", extract: "done", coverage: "running" }) : steps({ parse: "done", extract: "running" }),
  });
}
