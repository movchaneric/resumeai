import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunId } from "@resume-ai/shared";
import { createPostgresCheckpointer } from "@/graph/checkpointer.js";
import { parseCv } from "@/parsing/parseCv.js";
import { loadConfig } from "@/utils/config.js";
import { LangGraphRunner } from "@/graph/runner.js";
import { createCheckpointDb } from "../fakes/checkpointDb.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { FakeJobProfileCache } from "../fakes/jobProfileCache.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";

const url = process.env.DATABASE_URL!;
const config = loadConfig(process.env);
const { pool, checkpointer, end: endCheckpointDb } = createCheckpointDb(url);

const tablesIn = async (schema: string) =>
  (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name", [schema])).rows.map(
    (r) => r.table_name as string,
  );

// Every table the checkpointer creates, including its migrations table (which has no `thread_id`).
const CHECKPOINT_TABLES = ["checkpoint_blobs", "checkpoint_migrations", "checkpoint_writes", "checkpoints"];

beforeAll(async () => {
  // Drop leftovers from earlier runs, so setup() must create the tables where the code says it does.
  await pool.query("DROP SCHEMA IF EXISTS checkpoints CASCADE");
  for (const table of CHECKPOINT_TABLES) await pool.query(`DROP TABLE IF EXISTS public.${table} CASCADE`);
  await checkpointer.setup();
});
afterAll(async () => {
  await endCheckpointDb();
});

describe("Postgres checkpointer", () => {
  it("creates its tables in the checkpoints schema, saves a Run's state under its id and reads it back", async () => {
    expect(await tablesIn("checkpoints")).toEqual(
      expect.arrayContaining(CHECKPOINT_TABLES),
    );

    const llm = new FakeLlmClient().enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", coverageAnswer);
    const statuses: string[] = [];
    const runner = new LangGraphRunner({ llm, judgeLlm: llm, judgeModel: "test-judge", jobProfileCache: new FakeJobProfileCache(), checkpointer }, {
      setStatus: async (_id, status) => void statuses.push(status),
    }, new InProcessRunEvents());
    const runId = randomUUID() as RunId;
    await runner.start({ runId, cvText: await parseCv(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf")), config.limits), jobDescriptionText: "Backend developer" });

    // A fresh runner over the same database sees the saved state: it is in the checkpoint, not in memory.
    const readerCheckpointer = createPostgresCheckpointer(url);
    const reader = new LangGraphRunner({ llm, judgeLlm: llm, judgeModel: "test-judge", jobProfileCache: new FakeJobProfileCache(), checkpointer: readerCheckpointer }, {
      setStatus: async () => {},
    }, new InProcessRunEvents());
    const state = await reader.read(runId);
    expect(state?.jobProfile?.title).toBe("Backend Developer");
    expect(state?.scoreBefore).toBe(100);
    expect(state?.exitReason).toBe("target_reached");
    expect(statuses).toEqual(["extracting", "awaiting_review"]);
    expect(await reader.read(randomUUID() as RunId)).toBeNull();
    await readerCheckpointer.end();

    for (const schema of ["public", "app"]) {
      const tables = await tablesIn(schema);
      for (const table of CHECKPOINT_TABLES) expect(tables).not.toContain(table);
    }
    expect(await tablesIn("app")).toContain("runs");
  });
  it("pauses for Answers and resumes from the checkpoint, even through a fresh runner", async () => {
    const job = { ...extractedJob, requirements: [...extractedJob.requirements, { text: "Kubernetes", source: "Kubernetes", kind: "skill", importance: "must_have" }] };
    const coverage = {
      verdicts: [
        { requirementId: "req1", reason: "r", evidenceIds: ["exp1.b1"], verdict: "met" },
        { requirementId: "req2", reason: "r", evidenceIds: [], verdict: "unmet" },
      ],
    };
    const llm = new FakeLlmClient().enqueue("extract_job_profile", job).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", coverage).enqueue("tailor", { changes: [] }, { changes: [] });
    const statuses: string[] = [];
    const make = (cp: ReturnType<typeof createPostgresCheckpointer>) =>
      new LangGraphRunner({ llm, judgeLlm: llm, judgeModel: "test-judge", jobProfileCache: new FakeJobProfileCache(), checkpointer: cp }, { setStatus: async (_id, status) => void statuses.push(status) }, new InProcessRunEvents());
    const runId = randomUUID() as RunId;
    const paused = await make(checkpointer).start({ runId, cvText: await parseCv(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf")), config.limits), jobDescriptionText: "Backend developer" });
    expect(paused.questions.map((q) => q.requirementId)).toEqual(["req2"]);

    const resumeCheckpointer = createPostgresCheckpointer(url);
    const resumed = await make(resumeCheckpointer).answer(runId, [{ kind: "has_experience", questionId: paused.questions[0]!.id, text: "Ran clusters at Acme." }]);
    await resumeCheckpointer.end();
    expect(resumed.userEvidence).toEqual([{ id: "ue1", questionId: "q1", requirementId: "req2", text: "Ran clusters at Acme." }]);
    expect(resumed.exitReason).toBe("ceiling");
    expect(statuses).toEqual(["extracting", "awaiting_answers", "tailoring", "awaiting_review"]);
  });
});
