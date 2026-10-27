import type { RunId, RunStatus } from "@resume-ai/shared";
import type { CheckpointStore } from "@/stores/checkpoints.js";
import type { JobProfileStore } from "@/stores/jobProfiles.js";
import type { RunStore } from "@/stores/runs.js";

export type SweepDeps = {
  store: Pick<RunStore, "listExpired">;
  jobProfiles: Pick<JobProfileStore, "deleteExpired">;
  checkpoints: Pick<CheckpointStore, "deleteOrphans">;
  /**
   * `RunsService.purgeExpiredRun`: skips a Run this process is running, otherwise deletes it (row, then checkpoints)
   * only if it is still in the listed status. Says whether it deleted the Run.
   */
  purgeExpiredRun: (id: RunId, listedStatus: RunStatus) => Promise<boolean>;
};

export type SweepResult = { runs: number; jobProfiles: number; orphanRows: number };

/** The TTL sweep (ADR 0002): one pass deletes what has expired. It knows nothing about timers; `utils/sweepScheduler.ts` runs it. */
export class SweepService {
  constructor(private readonly deps: SweepDeps) {}

  /**
   * One pass: expired Runs, except the ones this process is running (`purgeExpiredRun` skips them; they are picked up
   * once they rest), expired Job Profiles, then
   * checkpoint threads with no Run. A step that fails is logged and does not stop the others. Never throws. Logs one
   * summary line with counts (and the ids of the Runs it could not delete), never content.
   */
  async sweep(): Promise<SweepResult> {
    const { store, jobProfiles, checkpoints, purgeExpiredRun } = this.deps;
    const now = new Date();
    const result: SweepResult = { runs: 0, jobProfiles: 0, orphanRows: 0 };
    const failed: string[] = [];

    try {
      for (const { id, status } of await store.listExpired(now)) {
        try {
          if (await purgeExpiredRun(id, status)) result.runs += 1;
        } catch (error) {
          failed.push(id);
          console.error(`Sweep: could not delete Run ${id}`, error);
        }
      }
    } catch (error) {
      failed.push("runs");
      console.error("Sweep: could not list the expired Runs", error);
    }
    try {
      result.jobProfiles = await jobProfiles.deleteExpired();
    } catch (error) {
      failed.push("job_profiles");
      console.error("Sweep: could not delete the expired Job Profiles", error);
    }
    try {
      result.orphanRows = await checkpoints.deleteOrphans();
    } catch (error) {
      failed.push("orphans");
      console.error("Sweep: could not delete the orphaned checkpoints", error);
    }

    console.log(
      `Sweep: deleted ${result.runs} expired Runs, ${result.jobProfiles} Job Profiles, ${result.orphanRows} orphaned checkpoint rows` +
        (failed.length > 0 ? `; failed: ${failed.join(", ")}` : ""),
    );
    return result;
  }
}
