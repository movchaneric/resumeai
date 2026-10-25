import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import type { RunId } from "@resume-ai/shared";
import { createPostgresCheckpointer } from "@/graph/checkpointer.js";
import { parseCv } from "@/parsing/parseCv.js";
import { loadConfig } from "@/utils/config.js";
import { LangGraphRunner } from "@/graph/runner.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";

const url = process.env.DATABASE_URL!;
const config = loadConfig(process.env);
const pool = new pg.Pool({ connectionString: url });
const checkpointer = createPostgresCheckpointer(`${url}?schema=app`);

const tablesIn = async (schema: string) =>
  (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name", [schema])).rows.map(
    (r) => r.table_name as string,
  );

const CHECKPOINT_TABLES = ["checkpoint_blobs", "checkpoint_migrations", "checkpoint_writes", "checkpoints"];

beforeAll(async () => {
  // Drop leftovers from earlier runs, so setup() must create the tables where the code says it does.
  await pool.query("DROP SCHEMA IF EXISTS checkpoints CASCADE");
  for (const table of CHECKPOINT_TABLES) await pool.query(`DROP TABLE IF EXISTS public.${table} CASCADE`);
  await checkpointer.setup();
});
afterAll(async () => {
  await checkpointer.end();
  await pool.end();
});

describe("Postgres checkpointer", () => {
  it("creates its tables in the checkpoints schema, saves a Run's state under its id and reads it back", async () => {
    expect(await tablesIn("checkpoints")).toEqual(
      expect.arrayContaining(CHECKPOINT_TABLES),
    );

    const llm = new FakeLlmClient().enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv).enqueue("assess_coverage", coverageAnswer);
    const statuses: string[] = [];
    const runner = new LangGraphRunner({ llm, judgeLlm: llm, checkpointer }, {
      setStatus: async (_id, status) => void statuses.push(status),
    });
    const runId = randomUUID() as RunId;
    await runner.start({ runId, cvText: await parseCv(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf")), config.limits), jobDescriptionText: "Backend developer" });

    // A fresh runner over the same database sees the saved state: it is in the checkpoint, not in memory.
    const readerCheckpointer = createPostgresCheckpointer(url);
    const reader = new LangGraphRunner({ llm, judgeLlm: llm, checkpointer: readerCheckpointer }, {
      setStatus: async () => {},
    });
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
});
