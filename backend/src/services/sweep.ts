import type { RunId } from "@resume-ai/shared";
import { BUSY_STATUSES } from "@/services/runs.js";
import type { CheckpointStore } from "@/stores/checkpoints.js";
import type { JobProfileStore } from "@/stores/jobProfiles.js";
import type { RunStore } from "@/stores/runs.js";

export type SweepDeps = {
  store: Pick<RunStore, "listExpiredIds">;
  jobProfiles: Pick<JobProfileStore, "deleteExpired">;
  checkpoints: Pick<CheckpointStore, "deleteOrphans">;
  /** `RunsService.purgeRun`: the one "delete this Run" operation (row, then checkpoints). */
  purgeRun: (id: RunId, liveAt?: Date, cutOffBefore?: Date) => Promise<boolean>;
  /** When this process started, as passed to `recoverRuns`: a busy Run created before it is not being worked on (one instance). */
  startedAt: Date;
  now?: () => Date;
};

export type SweepResult = { runs: number; jobProfiles: number; orphanRows: number };

/** The TTL sweep (ADR 0002): one pass deletes what has expired. It knows nothing about timers; `utils/sweepScheduler.ts` runs it. */
export class SweepService {
  constructor(private readonly deps: SweepDeps) {}

  /**
   * One pass: expired Runs, except busy ones created since this process started (it may be running them; they are
   * picked up once they rest), expired Job Profiles, then
   * checkpoint threads with no Run. A step that fails is logged and does not stop the others. Never throws. Logs one
   * summary line with counts (and the ids of the Runs it could not delete), never content.
   */
  async sweep(): Promise<SweepResult> {
    const { store, jobProfiles, checkpoints, purgeRun, startedAt } = this.deps;
    const now = (this.deps.now ?? (() => new Date()))();
    const result: SweepResult = { runs: 0, jobProfiles: 0, orphanRows: 0 };
    const failed: string[] = [];

    try {
      for (const id of await store.listExpiredIds(now, BUSY_STATUSES, startedAt)) {
        try {
          if (await purgeRun(id, undefined, startedAt)) result.runs += 1;
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
