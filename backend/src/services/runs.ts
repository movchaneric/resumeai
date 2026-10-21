import { randomUUID } from "node:crypto";
import { RunIdSchema, RunViewSchema, StepKeySchema, type RunId, type RunView } from "@resume-ai/shared";
import type { Config } from "@/utils/config.js";
import { ApiError } from "@/utils/errors.js";
import { parseCv, stripNul } from "@/parsing/parseCv.js";
import type { RunStore, StoredRun } from "@/stores/runs.js";

export type RunsDeps = { store: RunStore; config: Config; now?: () => Date };

export type CreateRunInput = { cv: Buffer; jobDescription: unknown };

/** The business rules for a Run. It knows nothing about HTTP. */
export class RunsService {
  private readonly now: () => Date;

  constructor(private readonly deps: RunsDeps) {
    this.now = deps.now ?? (() => new Date());
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
    return run.id;
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
 * Slice 1 parks every Run at `extracting` with `parse` done: nothing advances it until slice 2 adds
 * extraction. Validating against the schema keeps the response honest as the view grows.
 */
function toRunView(run: StoredRun): RunView {
  return RunViewSchema.parse({
    id: run.id,
    status: "extracting",
    createdAt: run.createdAt.toISOString(),
    expiresAt: run.expiresAt.toISOString(),
    job: null,
    steps: StepKeySchema.options.map((key) => ({ key, state: key === "parse" ? "done" : "pending" })),
  });
}
