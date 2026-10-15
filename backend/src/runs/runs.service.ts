import { randomUUID } from "node:crypto";
import { RunIdSchema, type RunId, type RunView } from "@resume-ai/shared";
import type { Config } from "@/config.js";
import { ApiError } from "@/errors.js";
import { parseCv, stripNul } from "@/parsing/parse-cv.js";
import type { RunStore } from "@/runs/run-store.js";
import { toRunView } from "@/runs/run-view.js";

type Deps = { store: RunStore; config: Config; now?: () => Date };

export type CreateRunInput = { cv: Buffer; jobDescription: string };

/** The business rules for a Run. It knows nothing about HTTP. */
export class RunsService {
  private readonly now: () => Date;

  constructor(private readonly deps: Deps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Validates and parses the upload, then stores the Run. Throws an `ApiError` when the upload is rejected. */
  async createRun({ cv, jobDescription }: CreateRunInput): Promise<RunId> {
    const { store, config } = this.deps;
    const jdText = stripNul(jobDescription).trim();
    if (!jdText) throw new ApiError("BAD_REQUEST", "The `jobDescription` field is required.");
    if (jdText.length > config.limits.maxJdChars) {
      throw new ApiError("JOB_DESCRIPTION_TOO_LONG", `The job description is longer than ${config.limits.maxJdChars} characters.`);
    }

    const cvText = await parseCv(cv, config.limits);
    const run = await store.create({
      id: RunIdSchema.parse(randomUUID()),
      status: "extracting",
      expiresAt: new Date(this.now().getTime() + config.runTtlMs),
      cvText,
      jdText,
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
