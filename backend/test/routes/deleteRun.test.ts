import { RunIdSchema } from "@resume-ai/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import { CHECKPOINT_TABLES, createCheckpointDb } from "../fakes/checkpointDb.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { makeGraphRunner } from "../fakes/runGraph.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The real Postgres checkpointer: a 204 must leave no row for the Run in `app.runs` or any checkpoint table.

const url = process.env.DATABASE_URL!;
const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);
const { checkpointer, rowsFor, end: endCheckpointDb } = createCheckpointDb(url);
const llm = new FakeLlmClient();
const events = new InProcessRunEvents();
let tasks: Promise<void>[] = [];
const runInBackground = (task: () => Promise<void>) => {
  tasks.push(task());
};
const graphRunner = makeGraphRunner(store, llm, llm, undefined, events, checkpointer);
const app = createApp({ store, config, graphRunner, events, runInBackground });

const cv = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));

beforeAll(async () => {
  await checkpointer.setup();
});
beforeEach(async () => {
  await store.deleteAll();
  tasks = [];
});
afterAll(async () => {
  await endCheckpointDb();
  await prisma.$disconnect();
});

describe("DELETE /runs/:id with the Postgres checkpointer", () => {
  it("leaves no row for the Run in app.runs or any checkpoint table", async () => {
    llm.enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", coverageAnswer);
    const created = await request(app).post("/runs").attach("cv", cv, "cv.pdf").field("jobDescription", "Backend developer with Node.js and PostgreSQL.");
    const id = RunIdSchema.parse(created.body.id);
    await Promise.all(tasks);
    expect((await request(app).get(`/runs/${id}`)).body.status).toBe("awaiting_review");
    for (const table of CHECKPOINT_TABLES) expect(await rowsFor(table, id)).toBeGreaterThan(0);

    const res = await request(app).delete(`/runs/${id}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");

    expect((await request(app).get(`/runs/${id}`)).status).toBe(404);
    expect(await store.get(id)).toBeNull();
    for (const table of CHECKPOINT_TABLES) expect(await rowsFor(table, id)).toBe(0);
  });
});
