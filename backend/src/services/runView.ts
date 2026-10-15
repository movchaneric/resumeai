import { RunViewSchema, StepKeySchema, type RunView } from "@resume-ai/shared";
import type { StoredRun } from "@/stores/runStore.js";

/**
 * Slice 1 parks every Run at `extracting` with `parse` done: nothing advances it until slice 2 adds
 * extraction. Validating against the schema keeps the response honest as the view grows.
 */
export function toRunView(run: StoredRun): RunView {
  return RunViewSchema.parse({
    id: run.id,
    status: "extracting",
    createdAt: run.createdAt.toISOString(),
    expiresAt: run.expiresAt.toISOString(),
    job: null,
    steps: StepKeySchema.options.map((key) => ({ key, state: key === "parse" ? "done" : "pending" })),
  });
}
