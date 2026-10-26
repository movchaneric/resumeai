import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { context, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { RunIdSchema, type RunId, type RunView } from "@resume-ai/shared";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { ExtractionError } from "@/extraction/errors.js";
import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import { COVERAGE_VOTES } from "@/scoring/assessCoverage.js";
import { RunsService } from "@/services/runs.js";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import { GatedLlm } from "../fakes/gatedLlm.js";
import { FakeJobProfileCache } from "../fakes/jobProfileCache.js";
import { makeGraphRunner } from "../fakes/runGraph.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";

// A crash is simulated by holding a model call of one "process" forever: its Run never moves again. A fresh "process"
// (new runner, service, bus and model) on the same store and checkpointer then calls `recoverRuns(STARTED_AT)`.

const cvFile = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));
const JOB_DESCRIPTION = "We are hiring a backend developer with Node.js and PostgreSQL experience.";
/** When the recovering process started: every Run is older than this unless a test says otherwise. */
const STARTED_AT = new Date(Date.now() + 60_000);
const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

/** Three Requirements, two unmet: the Run pauses for Answers. */
const questionsJob = {
  ...extractedJob,
  requirements: ["Node.js", "PostgreSQL", "Kubernetes"].map((text) => ({ text, source: text, kind: "skill", importance: "must_have" })),
};
const questionsCoverage = {
  verdicts: ["met", "unmet", "unmet"].map((verdict, i) => ({
    requirementId: `req${i + 1}`,
    reason: "r",
    evidenceIds: verdict === "met" ? ["exp1.b1"] : [],
    verdict,
  })),
};

type Process = { checkpointer: BaseCheckpointSaver; llm: GatedLlm; events: InProcessRunEvents; service: RunsService; tasks: Promise<void>[] };

function boot(checkpointer: BaseCheckpointSaver, now?: () => Date, wrapStore: RunStore = store): Process {
  const llm = new GatedLlm();
  const events = new InProcessRunEvents();
  const tasks: Promise<void>[] = [];
  const graphRunner = makeGraphRunner(wrapStore, llm, llm, new FakeJobProfileCache(), events, checkpointer);
  const service = new RunsService({ store: wrapStore, config, graphRunner, events, now, runInBackground: (task) => void tasks.push(task()) });
  return { checkpointer, llm, events, service, tasks };
}

const enqueueExtraction = (llm: GatedLlm, job: object) => llm.enqueue("extract_job_profile", job).enqueue("extract_cv", extractedCv);
const enqueueQuestions = (llm: GatedLlm) => enqueueExtraction(llm, questionsJob).enqueueVoted("assess_coverage", questionsCoverage);
const enqueueReview = (llm: GatedLlm) => enqueueExtraction(llm, extractedJob).enqueueVoted("assess_coverage", coverageAnswer);

async function until(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const settle = async (process: Process) => {
  await Promise.all(process.tasks.splice(0));
};
const statusOf = async (id: RunId) => (await store.get(id))?.status;
const create = (process: Process, jobDescription = JOB_DESCRIPTION) => process.service.createRun({ cv: cvFile, jobDescription });
/** The view without what differs between two Runs of the same input. */
const comparable = (view: RunView) => ({ ...view, id: undefined, createdAt: undefined, expiresAt: undefined });
const stepStates = (view: RunView) => view.steps.map((s) => `${s.key}:${s.state}`);

/** Starts a Run and holds it in the model call `name`, so its process is "cut off" there. */
async function startHeldAt(process: Process, name: string): Promise<RunId> {
  process.llm.hold(name);
  const id = await create(process);
  await until(() => process.llm.held.includes(name), `a call to ${name}`);
  return id;
}

/** Runs a Run to its first Answers pause, answers it with none, and holds it in the model call `name` of tailoring. */
async function tailoringHeldAt(process: Process, name: string): Promise<RunId> {
  enqueueQuestions(process.llm);
  const id = await create(process);
  await settle(process);
  process.llm.hold(name);
  await process.service.submitAnswers(id, { answers: [] });
  await until(() => process.llm.held.includes(name), `a call to ${name}`);
  return id;
}

/** The same input run through without a stop, for the end state a resumed Run must match. */
async function uninterrupted(enqueue: (llm: GatedLlm) => void, answers: boolean): Promise<RunView> {
  const reference = boot(createMemoryCheckpointer());
  enqueue(reference.llm);
  const id = await create(reference);
  await settle(reference);
  if (answers) {
    reference.llm.enqueue("tailor", { changes: [] }, { changes: [] });
    await reference.service.submitAnswers(id, { answers: [] });
    await settle(reference);
  }
  return reference.service.getRunView(id);
}

let logs: string[] = [];
beforeAll(() => provider.register());
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await store.deleteAll();
  exporter.reset();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void logs.push(String(line)));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("RunsService.recoverRuns", () => {
  it("resumes a Run cut off in Coverage to the end state of an uninterrupted Run", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueExtraction(before.llm, questionsJob);
    const id = await startHeldAt(before, "assess_coverage");
    expect(await statusOf(id)).toBe("extracting");

    const after = boot(before.checkpointer);
    after.llm.enqueueVoted("assess_coverage", questionsCoverage);
    await after.service.recoverRuns(STARTED_AT);

    expect(await statusOf(id)).toBe("awaiting_answers");
    expect(comparable(await after.service.getRunView(id))).toEqual(comparable(await uninterrupted(enqueueQuestions, false)));
    expect(logs).toContain(`Run ${id}: recovery resumed`);
  });

  it("resumes a Run cut off in a tailoring round, after its Answers, to review", async () => {
    const before = boot(createMemoryCheckpointer());
    const id = await tailoringHeldAt(before, "tailor");
    expect(await statusOf(id)).toBe("tailoring");

    const after = boot(before.checkpointer);
    after.llm.enqueue("tailor", { changes: [] }, { changes: [] });
    await after.service.recoverRuns(STARTED_AT);

    expect(await statusOf(id)).toBe("awaiting_review");
    expect(comparable(await after.service.getRunView(id))).toEqual(comparable(await uninterrupted(enqueueQuestions, true)));
  });

  it("resumes a Run cut off in the first extraction call", async () => {
    const before = boot(createMemoryCheckpointer());
    const id = await startHeldAt(before, "extract_job_profile");

    const after = boot(before.checkpointer);
    enqueueReview(after.llm);
    await after.service.recoverRuns(STARTED_AT);

    expect(await statusOf(id)).toBe("awaiting_review");
  });

  it("marks a Run with no checkpoint interrupted", async () => {
    const id = RunIdSchema.parse(randomUUID());
    const createdAt = new Date();
    await store.create({ id, status: "extracting", createdAt, expiresAt: new Date(createdAt.getTime() + 60_000) });
    const process = boot(createMemoryCheckpointer());
    await process.service.recoverRuns(STARTED_AT);

    expect(await statusOf(id)).toBe("interrupted");
    expect(logs).toContain(`Run ${id}: recovery interrupted (no checkpoint)`);
    expect(process.llm.calls).toEqual([]);
  });

  it("restores the Pause's status when a claimed Answers submission was never resumed", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueQuestions(before.llm);
    const id = await create(before);
    await settle(before);
    expect(await store.claimStatus(id, "awaiting_answers", "tailoring")).toBe(true);

    const after = boot(before.checkpointer);
    await after.service.recoverRuns(STARTED_AT);

    expect(await statusOf(id)).toBe("awaiting_answers");
    expect((await after.service.getRunView(id)).status).toBe("awaiting_answers");
    expect(logs).toContain(`Run ${id}: recovery pause restored`);
    expect(after.llm.calls).toEqual([]);
    // Restoring a Pause is not a recovery, so the Run can still be recovered once later.
    expect(await store.claimRecovery(id, "awaiting_answers")).toBe(true);
  });

  it("restores review when the status write at the review Pause was lost", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueReview(before.llm);
    const id = await create(before);
    await settle(before);
    await store.setStatus(id, "tailoring");

    const after = boot(before.checkpointer);
    await after.service.recoverRuns(STARTED_AT);

    expect(await statusOf(id)).toBe("awaiting_review");
    expect(after.llm.calls).toEqual([]);
  });

  it("makes a Run that was already recovered once interrupted, without resuming the graph", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueExtraction(before.llm, questionsJob);
    const id = await startHeldAt(before, "assess_coverage");
    expect(await store.claimRecovery(id, "extracting")).toBe(true);

    const after = boot(before.checkpointer);
    after.llm.enqueueVoted("assess_coverage", questionsCoverage);
    await after.service.recoverRuns(STARTED_AT);

    expect(await statusOf(id)).toBe("interrupted");
    expect(after.llm.calls).toEqual([]);
    expect(logs).toContain(`Run ${id}: recovery interrupted (already recovered once)`);
  });

  it("recovers a Run only once across two restarts", async () => {
    const first = boot(createMemoryCheckpointer());
    enqueueExtraction(first.llm, questionsJob);
    const id = await startHeldAt(first, "assess_coverage");

    // The second process is cut off too, in the resumed Coverage call.
    const second = boot(first.checkpointer);
    second.llm.hold("assess_coverage");
    void second.service.recoverRuns(STARTED_AT);
    await until(() => second.llm.held.includes("assess_coverage"), "the resumed Coverage call");

    const third = boot(first.checkpointer);
    third.llm.enqueueVoted("assess_coverage", questionsCoverage);
    await third.service.recoverRuns(STARTED_AT);
    expect(await statusOf(id)).toBe("interrupted");
    expect(third.llm.calls).toEqual([]);
  });

  it("leaves expired Runs alone", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueExtraction(before.llm, questionsJob);
    const id = await startHeldAt(before, "assess_coverage");

    const later = new Date(Date.now() + config.runTtlMs + 1000);
    const after = boot(before.checkpointer, () => later);
    after.llm.enqueueVoted("assess_coverage", questionsCoverage);
    await after.service.recoverRuns(STARTED_AT);

    expect(await statusOf(id)).toBe("extracting");
    expect(after.llm.calls).toEqual([]);
    expect(logs.filter((line) => line.includes(id))).toEqual([]);
  });

  it("leaves a Run created after the process started alone, with or without a checkpoint", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueExtraction(before.llm, questionsJob);
    const checkpointed = await startHeldAt(before, "assess_coverage");
    const bare = RunIdSchema.parse(randomUUID());
    const createdAt = new Date();
    await store.create({ id: bare, status: "extracting", createdAt, expiresAt: new Date(createdAt.getTime() + 60_000) });

    const after = boot(before.checkpointer);
    const published = vi.fn();
    after.events.subscribe(checkpointed, published);
    after.events.subscribe(bare, published);
    await after.service.recoverRuns(new Date(createdAt.getTime() - 60_000));

    expect(await statusOf(checkpointed)).toBe("extracting");
    expect(await statusOf(bare)).toBe("extracting");
    expect(published).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
    expect(after.llm.calls).toEqual([]);
  });

  it("leaves Runs at a Pause alone and publishes nothing for them", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueQuestions(before.llm);
    const waiting = await create(before);
    await settle(before);
    enqueueReview(before.llm);
    // Another Job Description, so the first Run's cached Job Profile is not reused.
    const reviewing = await create(before, "A different backend role.");
    await settle(before);
    expect(await statusOf(waiting)).toBe("awaiting_answers");
    expect(await statusOf(reviewing)).toBe("awaiting_review");

    const after = boot(before.checkpointer);
    const published = vi.fn();
    after.events.subscribe(waiting, published);
    after.events.subscribe(reviewing, published);
    await after.service.recoverRuns(STARTED_AT);

    expect(await statusOf(waiting)).toBe("awaiting_answers");
    expect(await statusOf(reviewing)).toBe("awaiting_review");
    expect(published).not.toHaveBeenCalled();
    expect(logs).toEqual([]);
  });

  it("handles cut-off Runs one at a time", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueExtraction(before.llm, questionsJob);
    before.llm.hold("assess_coverage");
    const first = await create(before);
    await until(() => before.llm.held.length === COVERAGE_VOTES, "the first Run's Coverage");
    enqueueExtraction(before.llm, questionsJob);
    const second = await create(before);
    await until(() => before.llm.held.length === 2 * COVERAGE_VOTES, "the second Run's Coverage");

    const after = boot(before.checkpointer);
    after.llm.enqueueVoted("assess_coverage", questionsCoverage, questionsCoverage);
    const release = after.llm.hold("assess_coverage");
    const done = after.service.recoverRuns(STARTED_AT);
    await until(() => after.llm.held.length > 0, "the first resumed Coverage call");
    // Time for a second Run to start if recovery did not wait.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(after.llm.held).toHaveLength(COVERAGE_VOTES);

    release();
    await done;
    expect(await statusOf(first)).toBe("awaiting_answers");
    expect(await statusOf(second)).toBe("awaiting_answers");
  });

  it("records a failure in the resumed work as failed with the usual code and message", async () => {
    const before = boot(createMemoryCheckpointer());
    const id = await startHeldAt(before, "extract_job_profile");

    const after = boot(before.checkpointer);
    after.llm.enqueue("extract_job_profile", new ExtractionError("quotes Ada Lovelace", ["company Secret Corp not found"]));
    await after.service.recoverRuns(STARTED_AT);

    const view = await after.service.getRunView(id);
    expect(view.status).toBe("failed");
    if (view.status === "failed") {
      expect(view.error.code).toBe("EXTRACTION_FAILED");
      expect(view.error.message).toBe("We couldn't read the structure of your CV or job description. Try again, or upload a DOCX.");
    }
    expect(stepStates(view)).toContain("extract:failed");
    expect(logs.join("\n")).not.toContain("Lovelace");
  });

  it("writes the status only if the Run is still in the status recovery saw", async () => {
    const id = RunIdSchema.parse(randomUUID());
    const createdAt = new Date();
    await store.create({ id, status: "extracting", createdAt, expiresAt: new Date(createdAt.getTime() + 60_000) });
    // A request moves the Run between the listing and recovery's write.
    const racing = Object.create(store) as RunStore;
    racing.listLive = async (statuses, now, createdBefore) => {
      const listed = await store.listLive(statuses, now, createdBefore);
      await store.setStatus(id, "awaiting_review");
      return listed;
    };
    const process = boot(createMemoryCheckpointer(), undefined, racing);
    await process.service.recoverRuns(STARTED_AT);

    expect(await statusOf(id)).toBe("awaiting_review");
  });

  it("never throws, and carries on with the next Run when one cannot be handled", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueExtraction(before.llm, questionsJob);
    before.llm.hold("assess_coverage");
    const first = await create(before);
    await until(() => before.llm.held.length === COVERAGE_VOTES, "the first Run's Coverage");
    enqueueExtraction(before.llm, questionsJob);
    const second = await create(before);
    await until(() => before.llm.held.length === 2 * COVERAGE_VOTES, "the second Run's Coverage");

    const claim = store.claimRecovery.bind(store);
    const flaky = Object.create(store) as RunStore;
    flaky.claimRecovery = async (runId, status) => {
      if (runId === first) throw new Error("database down");
      return claim(runId, status);
    };
    const process = boot(before.checkpointer, undefined, flaky);
    process.llm.enqueueVoted("assess_coverage", questionsCoverage);
    await expect(process.service.recoverRuns(STARTED_AT)).resolves.toBeUndefined();

    expect(await statusOf(first)).toBe("extracting");
    expect(await statusOf(second)).toBe("awaiting_answers");

    const failingList = Object.create(store) as RunStore;
    failingList.listLive = async () => {
      throw new Error("database down");
    };
    await expect(boot(before.checkpointer, undefined, failingList).service.recoverRuns(STARTED_AT)).resolves.toBeUndefined();
  });

  it("runs the resumed work under a `recovery` root span with the session id and the pipeline's end attributes", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueExtraction(before.llm, extractedJob);
    const id = await startHeldAt(before, "assess_coverage");
    exporter.reset();

    const after = boot(before.checkpointer);
    after.llm.enqueueVoted("assess_coverage", coverageAnswer);
    await after.service.recoverRuns(STARTED_AT);

    const root = exporter.getFinishedSpans().find((span) => span.name === "recovery")!;
    expect(root.parentSpanContext).toBeUndefined();
    expect(root.attributes["session.id"]).toBe(id);
    expect(root.attributes["score.before"]).toBe(100);
    expect(root.attributes["score.after"]).toBe(100);
    expect(root.attributes["rounds"]).toBe(0);
    expect(root.attributes["exit_reason"]).toBe("target_reached");
    const coverage = exporter.getFinishedSpans().find((span) => span.name === "assess_coverage")!;
    expect(coverage.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
  });

  it("publishes every write recovery makes, so a stream opened before it follows the Run to its Pause", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueExtraction(before.llm, questionsJob);
    const id = await startHeldAt(before, "assess_coverage");

    const after = boot(before.checkpointer);
    after.llm.enqueueVoted("assess_coverage", questionsCoverage);
    const views: RunView[] = [];
    let closed = false;
    await after.service.openRunStream(id, { send: (view) => void views.push(view), close: () => (closed = true) });
    await after.service.recoverRuns(STARTED_AT);
    await until(() => closed, "the stream to close");

    expect(views[0]!.status).toBe("extracting");
    expect(views.at(-1)!.status).toBe("awaiting_answers");
  });

  it("publishes the interrupted status", async () => {
    const id = RunIdSchema.parse(randomUUID());
    const createdAt = new Date();
    await store.create({ id, status: "tailoring", createdAt, expiresAt: new Date(createdAt.getTime() + 60_000) });
    const process = boot(createMemoryCheckpointer());
    const views: RunView[] = [];
    let closed = false;
    await process.service.openRunStream(id, { send: (view) => void views.push(view), close: () => (closed = true) });
    await process.service.recoverRuns(STARTED_AT);
    await until(() => closed, "the stream to close");
    expect(views.map((v) => v.status)).toEqual(["extracting", "interrupted"]);
  });
});

describe("the interrupted view", () => {
  /** Recovers a Run that already used its one recovery, so it ends `interrupted`, and returns its view. */
  async function interruptedAfter(before: Process, id: RunId, status: "extracting" | "tailoring"): Promise<RunView> {
    expect(await store.claimRecovery(id, status)).toBe(true);
    const after = boot(before.checkpointer);
    await after.service.recoverRuns(STARTED_AT);
    return after.service.getRunView(id);
  }

  it("shows extract as the failed step when there is no checkpoint", async () => {
    const id = RunIdSchema.parse(randomUUID());
    const createdAt = new Date();
    await store.create({ id, status: "extracting", createdAt, expiresAt: new Date(createdAt.getTime() + 60_000) });
    const process = boot(createMemoryCheckpointer());
    await process.service.recoverRuns(STARTED_AT);
    const view = await process.service.getRunView(id);
    expect(view.status).toBe("interrupted");
    expect(stepStates(view)).toEqual(["parse:done", "extract:failed", "coverage:pending", "questions:pending", "tailor:pending", "review:pending", "export:pending"]);
  });

  it("shows extract as the failed step when extraction had not finished", async () => {
    const before = boot(createMemoryCheckpointer());
    before.llm.enqueue("extract_job_profile", extractedJob);
    const id = await startHeldAt(before, "extract_cv");
    const view = await interruptedAfter(before, id, "extracting");
    expect(view.status).toBe("interrupted");
    expect(stepStates(view).slice(0, 3)).toEqual(["parse:done", "extract:failed", "coverage:pending"]);
  });

  it("shows coverage as the failed step when there is no score yet", async () => {
    const before = boot(createMemoryCheckpointer());
    enqueueExtraction(before.llm, questionsJob);
    const id = await startHeldAt(before, "assess_coverage");
    const view = await interruptedAfter(before, id, "extracting");
    expect(view.status).toBe("interrupted");
    expect(view.job).toEqual({ title: "Backend Developer", company: "Initech" });
    expect(stepStates(view)).toEqual(["parse:done", "extract:done", "coverage:failed", "questions:pending", "tailor:pending", "review:pending", "export:pending"]);
  });

  it("shows tailor as the failed step once Coverage and the Questions are done", async () => {
    const before = boot(createMemoryCheckpointer());
    const id = await tailoringHeldAt(before, "tailor");
    const view = await interruptedAfter(before, id, "tailoring");
    expect(view.status).toBe("interrupted");
    expect(stepStates(view)).toEqual(["parse:done", "extract:done", "coverage:done", "questions:done", "tailor:failed", "review:pending", "export:pending"]);
  });
});
