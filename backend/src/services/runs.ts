import { randomUUID } from "node:crypto";
import {
  RunIdSchema,
  RunViewSchema,
  StepKeySchema,
  type Change,
  type Coverage,
  type Cv,
  type ExitReason,
  type JobProfile,
  type RunErrorCode,
  type RunId,
  type StepState,
  type RunView,
} from "@resume-ai/shared";
import { applyChanges } from "@/tailoring/applyChanges.js";
import type { RecordedRejection } from "@/tailoring/validateChanges.js";
import { CoverageError } from "@/scoring/errors.js";
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
  /** The current state, or null when no checkpoint exists yet. */
  read(runId: RunId): Promise<RunSnapshot | null>;
}

/** The most tailoring rounds a Run can use (decisions record, "Exit router"). */
const MAX_ROUNDS = 3;

export type RunsDeps = {
  store: RunStore;
  config: Config;
  graphRunner: GraphRunner;
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
    const { store, graphRunner } = this.deps;
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
        const code: RunErrorCode = failureCode(error);
        // Log the code, the error name and the issue count only. Messages and issues can quote CV values or
        // model output, so they are not logged here (known open item: a safe failure log).
        const name = error instanceof Error ? error.name : typeof error;
        const issues = (error as { issues?: unknown } | null)?.issues;
        const count = Array.isArray(issues) ? `, ${issues.length} issues` : "";
        console.error(`Run ${id}: pipeline failed (${code}) ${name}${count}`);
        await store.markFailed(id, code, FAILURE_MESSAGES[code]);
      }
    } catch (error) {
      console.error(`Run ${id}: could not store the pipeline outcome`, error);
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
          confirmedGap: false,
        };
      }),
      // The Tailored CV: the original plus the kept Changes.
      cv: applyChanges(cv, state.changes),
      changes: state.changes,
      userEvidence: [],
      iterations: { used: state.rounds, max: MAX_ROUNDS },
      exitReason: state.exitReason,
    });
  }
  if (run.status === "tailoring" && extracted && state) {
    return RunViewSchema.parse({
      ...common,
      status: "tailoring",
      job,
      steps: steps({ parse: "done", extract: "done", coverage: "done", questions: "done", tailor: "running" }),
      iterations: { used: state.rounds, max: MAX_ROUNDS },
      score: { before: Math.round(state.scoreBefore ?? 0), after: state.scoreAfter === null ? null : Math.round(state.scoreAfter) },
    });
  }
  return RunViewSchema.parse({
    ...common,
    status: "extracting",
    job,
    steps: extracted ? steps({ parse: "done", extract: "done", coverage: "running" }) : steps({ parse: "done", extract: "running" }),
  });
}
