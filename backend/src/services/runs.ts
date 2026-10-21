import { randomUUID } from "node:crypto";
import {
  RunIdSchema,
  RunViewSchema,
  StepKeySchema,
  type RunErrorCode,
  type RunId,
  type RunView,
} from "@resume-ai/shared";
import { ExtractionError, NoRequirementsError } from "@/extraction/errors.js";
import { extractCv } from "@/extraction/extractCv.js";
import { extractJobProfile } from "@/extraction/extractJobProfile.js";
import type { LlmClient } from "@/llm/llmClient.js";
import type { Config } from "@/utils/config.js";
import { ApiError } from "@/utils/errors.js";
import { parseCv, stripNul } from "@/parsing/parseCv.js";
import type { RunStore, StoredRun } from "@/stores/runs.js";

export type RunsDeps = {
  store: RunStore;
  config: Config;
  llm: LlmClient;
  now?: () => Date;
  /** Starts a task without awaiting it. Tests pass a version that collects the promises. */
  runInBackground?: (task: () => Promise<void>) => void;
};

/** Fire and forget: a rejection is logged so it can never become an unhandled rejection. */
function defaultRunInBackground(task: () => Promise<void>): void {
  task().catch((error: unknown) => console.error("Background task failed", error));
}

/** User-facing failure messages (plan, "Failure codes"). The real cause is logged, never shown. */
const FAILURE_MESSAGES: Record<"EXTRACTION_FAILED" | "NO_REQUIREMENTS" | "INTERNAL", string> = {
  EXTRACTION_FAILED: "We couldn't read the structure of your CV or job description. Try again, or upload a DOCX.",
  NO_REQUIREMENTS: "We couldn't find any requirements in this job description. Paste the full posting.",
  INTERNAL: "Something went wrong. Try again.",
};

function failureCode(error: unknown): keyof typeof FAILURE_MESSAGES {
  if (error instanceof NoRequirementsError) return "NO_REQUIREMENTS";
  if (error instanceof ExtractionError) return "EXTRACTION_FAILED";
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
    this.runInBackground(() => this.extractRun(run.id));
    return run.id;
  }

  /**
   * Extracts the Job Profile, then the CV, and stores the result or the failure on the Run.
   * It never throws: it runs detached from the request, so a failure has nowhere else to go.
   */
  async extractRun(id: RunId): Promise<void> {
    const { store, llm } = this.deps;
    try {
      const run = await store.get(id);
      if (!run) return;
      try {
        const jobProfile = await extractJobProfile(llm, run.jobDescriptionText);
        const { cv, softMismatches } = await extractCv(llm, run.cvText);
        console.debug(`Run ${id}: extraction done, ${softMismatches} soft mismatches`);
        await store.saveExtraction(id, { cv, jobProfile });
      } catch (error) {
        const code: RunErrorCode = failureCode(error);
        // Log the cause only: the error messages never carry the CV text.
        console.error(`Run ${id}: extraction failed (${code})`, error);
        await store.markFailed(id, code, FAILURE_MESSAGES[code]);
      }
    } catch (error) {
      console.error(`Run ${id}: could not store the extraction outcome`, error);
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
 * `extracting` until both results exist, and a failed Run shows its `extract` step as done because the
 * step states have no `failed`. Validating against the schema keeps the response honest as the view grows.
 */
function toRunView(run: StoredRun): RunView {
  const common = {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    expiresAt: run.expiresAt.toISOString(),
  };
  const steps = (extract: "running" | "done") =>
    StepKeySchema.options.map((key) => ({
      key,
      state: key === "parse" ? "done" : key === "extract" ? extract : "pending",
    }));

  if (run.status === "failed" && run.error) {
    return RunViewSchema.parse({ ...common, status: "failed", job: null, steps: steps("done"), error: run.error });
  }
  const extracted = run.cv !== null && run.jobProfile !== null;
  return RunViewSchema.parse({
    ...common,
    status: "extracting",
    job: extracted ? { title: run.jobProfile!.title, company: run.jobProfile!.company } : null,
    steps: steps(extracted ? "done" : "running"),
  });
}
