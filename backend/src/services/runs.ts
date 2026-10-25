import { randomUUID } from "node:crypto";
import {
  RunIdSchema,
  RunViewSchema,
  StepKeySchema,
  type RunErrorCode,
  type RunId,
  type StepState,
  type RunView,
} from "@resume-ai/shared";
import { assessCoverage } from "@/scoring/assessCoverage.js";
import { CoverageError } from "@/scoring/errors.js";
import { matchScore } from "@/scoring/matchScore.js";
import { ExtractionError, NoRequirementsError } from "@/extraction/errors.js";
import { extractCv } from "@/extraction/extractCv.js";
import { extractJobProfile } from "@/extraction/extractJobProfile.js";
import type { LlmClient } from "@/llm/llmClient.js";
import type { Config } from "@/utils/config.js";
import { ApiError } from "@/utils/errors.js";
import { withSessionSpan } from "@/utils/spans.js";
import { parseCv, stripNul } from "@/parsing/parseCv.js";
import type { RunStore, StoredRun } from "@/stores/runs.js";

export type RunsDeps = {
  store: RunStore;
  config: Config;
  llm: LlmClient;
  /** Judge-and-write work (Coverage now). Falls back to `llm` when unset. */
  judgeLlm?: LlmClient;
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
      cvText,
      jobDescriptionText,
    });
    this.runInBackground(() => this.runPipeline(run.id));
    return run.id;
  }

  /**
   * The background pipeline: extracts the Job Profile, then the CV, then assesses Coverage, storing each result
   * as it arrives, or the failure on the Run. It runs under one `pipeline` root span (`session.id` = the Run id,
   * `score` = the unrounded match score when it finishes).
   * It never throws: it runs detached from the request, so a failure has nowhere else to go.
   */
  async runPipeline(id: RunId): Promise<void> {
    const { store, llm } = this.deps;
    // Two clients: extraction is copying (checked by code), Coverage is judgement and may use a stronger model.
    const judgeLlm = this.deps.judgeLlm ?? llm;
    try {
      const run = await store.get(id);
      if (!run) return;
      try {
        await withSessionSpan("pipeline", id, async (span) => {
          const jobProfile = await extractJobProfile(llm, run.jobDescriptionText);
          const { cv, softMismatches } = await extractCv(llm, run.cvText);
          console.debug(`Run ${id}: extraction done, ${softMismatches} soft mismatches`);
          await store.saveExtraction(id, { cv, jobProfile });
          const { coverage } = await assessCoverage(judgeLlm, cv, jobProfile.requirements);
          await store.saveCoverage(id, coverage);
          span.setAttribute("score", matchScore(jobProfile.requirements, coverage));
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
    return toRunView(run);
  }
}

/**
 * Derives the view from what is stored (plan, "Behaviour seen from outside"). The status stays
 * `extracting` until Coverage is stored; the Coverage step runs once both extraction results exist.
 * A failed Run marks the step that broke as `failed`: `coverage` when the extraction results are stored,
 * otherwise `extract`. The score is computed here from the stored verdicts, never stored. Validating
 * against the schema keeps the response honest as the view grows.
 */
function toRunView(run: StoredRun): RunView {
  const common = {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    expiresAt: run.expiresAt.toISOString(),
  };
  const { cv, jobProfile, coverage } = run;
  const extracted = cv !== null && jobProfile !== null;
  const job = extracted ? { title: jobProfile.title, company: jobProfile.company } : null;
  const steps = (extract: StepState, coverageState: StepState) =>
    StepKeySchema.options.map((key) => ({
      key,
      state: key === "parse" ? "done" : key === "extract" ? extract : key === "coverage" ? coverageState : "pending",
    }));

  if (run.status === "failed" && run.error) {
    return RunViewSchema.parse({
      ...common,
      status: "failed",
      job,
      steps: extracted ? steps("done", "failed") : steps("failed", "pending"),
      error: run.error,
    });
  }
  if (run.status === "scored" && extracted && coverage !== null) {
    const verdictById = new Map(coverage.map((c) => [c.requirementId as string, c]));
    return RunViewSchema.parse({
      ...common,
      status: "scored",
      job,
      steps: steps("done", "done"),
      score: Math.round(matchScore(jobProfile.requirements, coverage)),
      requirements: jobProfile.requirements.map((requirement) => {
        const verdict = verdictById.get(requirement.id);
        return {
          id: requirement.id,
          text: requirement.text,
          importance: requirement.importance,
          verdict: verdict?.verdict ?? "unmet",
          evidenceIds: verdict?.evidenceIds ?? [],
          reason: verdict?.reason ?? "",
        };
      }),
    });
  }
  return RunViewSchema.parse({
    ...common,
    status: "extracting",
    job,
    steps: extracted ? steps("done", "running") : steps("running", "pending"),
  });
}
