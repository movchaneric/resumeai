import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunViewSchema, type RunId, type RunView } from "@resume-ai/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import type { LangGraphRunner } from "@/graph/runner.js";
import { RunsService } from "@/services/runs.js";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { makeGraphRunner } from "../fakes/runGraph.js";
import { FakeJobProfileCache } from "../fakes/jobProfileCache.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";

// A Run that reaches Review at once (nothing to tailor), then Review is resumed and the graph ends.

const cvFile = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));
const STARTED_AT = new Date(Date.now() + 60_000);
const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);

type Process = { runner: LangGraphRunner; service: RunsService; events: InProcessRunEvents; tasks: Promise<void>[] };

function boot(checkpointer: BaseCheckpointSaver): Process {
  const llm = new FakeLlmClient();
  llm.enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", coverageAnswer);
  const events = new InProcessRunEvents();
  const tasks: Promise<void>[] = [];
  const runner = makeGraphRunner(store, llm, llm, new FakeJobProfileCache(), events, checkpointer);
  const service = new RunsService({ store, config, graphRunner: runner, events, runInBackground: (task) => void tasks.push(task()) });
  return { runner, service, events, tasks };
}

/** Creates a Run and lets it reach Review. */
async function reachReview(process: Process): Promise<RunId> {
  const id = await process.service.createRun({ cv: cvFile, jobDescription: "We are hiring a backend developer with Node.js experience." });
  await Promise.all(process.tasks.splice(0));
  return id;
}

const statusOf = async (id: RunId) => (await store.get(id))?.status;

beforeEach(async () => {
  await store.deleteAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("Review as an interrupt", () => {
  it("reads awaiting_review while the graph waits inside the review node", async () => {
    const process = boot(createMemoryCheckpointer());
    const id = await reachReview(process);

    expect(await statusOf(id)).toBe("awaiting_review");
    expect((await process.runner.read(id))?.position).toBe("review");
    expect((await process.service.getRunView(id)).status).toBe("awaiting_review");
  });

  it("restores a lost awaiting_review write at recovery", async () => {
    const checkpointer = createMemoryCheckpointer();
    const before = boot(checkpointer);
    const id = await reachReview(before);
    await store.setStatus(id, "tailoring");

    const after = boot(checkpointer);
    await after.service.recoverRuns(STARTED_AT);

    expect(await statusOf(id)).toBe("awaiting_review");
  });

  it("ends the graph and writes completed when Review is resumed, and the stream closes on the completed view", async () => {
    const process = boot(createMemoryCheckpointer());
    const id = await reachReview(process);
    // As the claim of a review submission would leave it; the stream ends at awaiting_review, so it opens after.
    await store.setStatus(id, "tailoring");
    const views: RunView[] = [];
    let closed = false;
    await process.service.openRunStream(id, { send: (view) => views.push(view), close: () => (closed = true) });
    expect(closed).toBe(false);

    const snapshot = await process.runner.review(id, []);

    expect(snapshot.position).toBe("ended");
    expect(await statusOf(id)).toBe("completed");
    await vi.waitFor(() => expect(closed).toBe(true));
    const last = views.at(-1)!;
    expect(last.status).toBe("completed");
    const view = await process.service.getRunView(id);
    expect(RunViewSchema.safeParse(view).success).toBe(true);
    expect(view).toMatchObject({ status: "completed", download: { docx: `/runs/${id}/cv.docx`, pdf: `/runs/${id}/cv.pdf` } });
  });
});

describe("recovery of a Run whose graph has ended (P6)", () => {
  it("moves a Run found in tailoring with the graph ended to completed, not awaiting_review", async () => {
    const checkpointer = createMemoryCheckpointer();
    const before = boot(checkpointer);
    const id = await reachReview(before);
    await before.runner.review(id, []);
    // The crash fell between the last checkpoint and the status write.
    await store.setStatus(id, "tailoring");

    const after = boot(checkpointer);
    await after.service.recoverRuns(STARTED_AT);

    expect(await statusOf(id)).toBe("completed");
    expect((await after.service.getRunView(id)).status).toBe("completed");
  });
});
