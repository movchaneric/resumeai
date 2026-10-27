import { RunIdSchema, type RunId, type RunStatus } from "@resume-ai/shared";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCv } from "@/parsing/parseCv.js";
import { RunsService, type GraphRunner } from "@/services/runs.js";
import { SweepService } from "@/services/sweep.js";
import { CheckpointStore } from "@/stores/checkpoints.js";
import { JobProfileStore } from "@/stores/jobProfiles.js";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import { CHECKPOINT_TABLES, createCheckpointDb } from "../fakes/checkpointDb.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { makeGraphRunner } from "../fakes/runGraph.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";

// Real Postgres store and checkpointer: a pass must leave no row in `app.runs` or any checkpoint table for what it deletes.

const url = process.env.DATABASE_URL!;
const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);
const { pool, checkpointer, rowsFor, end: endCheckpointDb } = createCheckpointDb(url);
const llm = new FakeLlmClient();
const events = new InProcessRunEvents();
const graphRunner = makeGraphRunner(store, llm, llm, undefined, events, checkpointer);
const runs = new RunsService({ store, config, graphRunner, events });
const profiles = new JobProfileStore(prisma, { ttlMs: 1000 });
const sweep = new SweepService({ store, jobProfiles: profiles, checkpoints: new CheckpointStore(prisma), purgeExpiredRun: (id, status) => runs.purgeExpiredRun(id, status) });

const cvText = await parseCv(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf")), config.limits);
const HOUR = 60 * 60 * 1000;
const expectThread = async (id: string, present: boolean) => {
  for (const table of CHECKPOINT_TABLES) {
    if (present) expect(await rowsFor(table, id), table).toBeGreaterThan(0);
    else expect(await rowsFor(table, id), table).toBe(0);
  }
};

/** A Run row with a real checkpoint thread, set to `status` and expiring `expiresInMs` from now (negative: already expired). */
async function seedRun(status: RunStatus, expiresInMs: number): Promise<RunId> {
  const id = RunIdSchema.parse(randomUUID());
  await store.create({ id, status: "extracting", createdAt: new Date(), expiresAt: new Date(Date.now() + HOUR) });
  llm.enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", coverageAnswer);
  await graphRunner.start({ runId: id, cvText, jobDescriptionText: "Backend developer with Node.js and PostgreSQL." });
  await prisma.run.update({ where: { id }, data: { status, expiresAt: new Date(Date.now() + expiresInMs) } });
  await expectThread(id, true);
  return id;
}

beforeAll(async () => {
  await checkpointer.setup();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await store.deleteAll();
  await prisma.jobProfile.deleteMany();
  await pool.query("TRUNCATE checkpoints.checkpoints, checkpoints.checkpoint_blobs, checkpoints.checkpoint_writes");
});
afterAll(async () => {
  await endCheckpointDb();
  await prisma.$disconnect();
});

describe("SweepService.sweep with Postgres", () => {
  it("deletes expired Runs that are not busy, with all their checkpoints", async () => {
    const paused = await seedRun("awaiting_review", -HOUR);
    const failed = await seedRun("failed", -HOUR);
    const done = await seedRun("completed", -HOUR);

    const result = await sweep.sweep();

    expect(result.runs).toBe(3);
    for (const id of [paused, failed, done]) {
      expect(await store.get(id)).toBeNull();
      await expectThread(id, false);
    }
  });

  it("leaves a Run that has not expired alone", async () => {
    const live = await seedRun("awaiting_review", HOUR);
    await sweep.sweep();
    expect(await store.get(live)).not.toBeNull();
    await expectThread(live, true);
  });

  it("deletes an expired busy Run that this process is not running, with all its checkpoints", async () => {
    const ids = [await seedRun("parsing", -HOUR), await seedRun("extracting", -HOUR), await seedRun("tailoring", -HOUR)];
    const result = await sweep.sweep();
    expect(result.runs).toBe(3);
    for (const id of ids) {
      expect(await store.get(id)).toBeNull();
      await expectThread(id, false);
    }
  });

  it("leaves a busy Run alone while it has not expired", async () => {
    const id = await seedRun("tailoring", HOUR);
    await sweep.sweep();
    expect(await store.get(id)).not.toBeNull();
    await expectThread(id, true);
  });

  it("skips a Run this process resumed that expires mid-run, and deletes it once the work has ended", async () => {
    const id = await seedRun("awaiting_review", HOUR);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const gated: GraphRunner = {
      start: (input) => graphRunner.start(input),
      answer: (runId, answers) => graphRunner.answer(runId, answers),
      review: async (runId, decisions) => {
        await gate;
        return graphRunner.review(runId, decisions, []);
      },
      recover: (runId) => graphRunner.recover(runId),
      read: (runId) => graphRunner.read(runId),
      deleteThread: (runId) => graphRunner.deleteThread(runId),
    };
    const tasks: Promise<void>[] = [];
    const resumer = new RunsService({ store, config, graphRunner: gated, events, runInBackground: (task) => void tasks.push(task()) });
    const sweepResumer = new SweepService({ store, jobProfiles: profiles, checkpoints: new CheckpointStore(prisma), purgeExpiredRun: (runId, status) => resumer.purgeExpiredRun(runId, status) });

    await resumer.submitReview(id, { decisions: [] });
    expect((await store.get(id))?.status).toBe("tailoring");
    await prisma.run.update({ where: { id }, data: { expiresAt: new Date(Date.now() - HOUR) } });

    expect((await sweepResumer.sweep()).runs).toBe(0);
    expect(await store.get(id)).not.toBeNull();
    await expectThread(id, true);

    release();
    await Promise.all(tasks);
    expect((await store.get(id))?.status).toBe("completed");
    expect((await sweepResumer.sweep()).runs).toBe(1);
    expect(await store.get(id)).toBeNull();
    await expectThread(id, false);
  });

  it("does not delete a Run whose status changed between the listing and the delete", async () => {
    const id = await seedRun("awaiting_review", -HOUR);
    const moving = new SweepService({
      store: {
        listExpired: async (now) => {
          const listed = await store.listExpired(now);
          await store.claimStatus(id, "awaiting_review", "tailoring");
          return listed;
        },
      },
      jobProfiles: profiles,
      checkpoints: new CheckpointStore(prisma),
      purgeExpiredRun: (runId, status) => runs.purgeExpiredRun(runId, status),
    });

    expect((await moving.sweep()).runs).toBe(0);
    expect((await store.get(id))?.status).toBe("tailoring");
    await expectThread(id, true);
  });

  it("deletes expired Job Profiles and keeps fresh ones", async () => {
    const data = { profile: { title: "Made-up" }, createdAt: new Date() };
    await prisma.jobProfile.createMany({
      data: [
        { key: "old", expiresAt: new Date(Date.now() - HOUR), ...data },
        { key: "fresh", expiresAt: new Date(Date.now() + HOUR), ...data },
      ],
    });
    const result = await sweep.sweep();
    expect(result.jobProfiles).toBe(1);
    expect((await prisma.jobProfile.findMany()).map((row) => row.key)).toEqual(["fresh"]);
  });

  it("deletes an orphaned checkpoint thread from every table and keeps a live Run's", async () => {
    const orphan = await seedRun("awaiting_review", HOUR);
    const live = await seedRun("awaiting_review", HOUR);
    await store.delete(orphan);
    await expectThread(orphan, true);

    const result = await sweep.sweep();

    expect(result.orphanRows).toBeGreaterThan(0);
    await expectThread(orphan, false);
    await expectThread(live, true);
    expect(await store.get(live)).not.toBeNull();
  });

  it("removes a thread whose delete failed when its Run was purged", async () => {
    const id = await seedRun("awaiting_review", -HOUR);
    vi.spyOn(graphRunner, "deleteThread").mockRejectedValueOnce(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect((await sweep.sweep()).runs).toBe(1);
    expect(await store.get(id)).toBeNull();
    await expectThread(id, false);
  });
});

describe("SweepService.sweep when a step fails", () => {
  const fakes = () => ({
    store: { listExpired: vi.fn(async () => [{ id: "a" as RunId, status: "awaiting_review" as RunStatus }, { id: "b" as RunId, status: "failed" as RunStatus }]) },
    jobProfiles: { deleteExpired: vi.fn(async () => 2) },
    checkpoints: { deleteOrphans: vi.fn(async () => 5) },
    purgeExpiredRun: vi.fn(async () => true),
  });

  it("still runs the other steps when the Job Profile delete throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = fakes();
    deps.jobProfiles.deleteExpired.mockRejectedValue(new Error("boom"));
    expect(await new SweepService(deps).sweep()).toEqual({ runs: 2, jobProfiles: 0, orphanRows: 5 });
  });

  it("still runs the other steps when listing Runs throws, and when one Run's delete throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const listFails = fakes();
    listFails.store.listExpired.mockRejectedValue(new Error("boom"));
    expect(await new SweepService(listFails).sweep()).toEqual({ runs: 0, jobProfiles: 2, orphanRows: 5 });

    const oneFails = fakes();
    oneFails.purgeExpiredRun.mockRejectedValueOnce(new Error("boom"));
    expect(await new SweepService(oneFails).sweep()).toEqual({ runs: 1, jobProfiles: 2, orphanRows: 5 });
  });

  it("still deletes Runs and Job Profiles when the orphan scan throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = fakes();
    deps.checkpoints.deleteOrphans.mockRejectedValue(new Error("boom"));
    expect(await new SweepService(deps).sweep()).toEqual({ runs: 2, jobProfiles: 2, orphanRows: 0 });
  });
});
