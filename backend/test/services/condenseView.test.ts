import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunId, RunView } from "@resume-ai/shared";
import { layoutCv } from "@/export/layout.js";
import { renderPdf } from "@/export/pdfRenderer.js";
import { sizesForStep } from "@/export/sizes.js";
import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import { RunsService } from "@/services/runs.js";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import { GatedLlm } from "../fakes/gatedLlm.js";
import { FakeJobProfileCache } from "../fakes/jobProfileCache.js";
import { makeGraphRunner } from "../fakes/runGraph.js";
import { longCv, longExtracted } from "../fixtures/longCv.js";
import { extractedJob } from "../runFixtures.js";

// The `fit` step of the Run view while a too-long CV is condensed. The long CV is rendered to a real PDF so the Run parses it.

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);
const STARTED_AT = new Date(Date.now() + 60_000);

const job = { ...extractedJob, requirements: [{ text: "Kubernetes", source: "Kubernetes", kind: "skill", importance: "must_have" }] };
const coverage = { verdicts: [{ requirementId: "req1", reason: "r", evidenceIds: ["exp1.b1"], verdict: "met" }] };
const states = (view: RunView) => view.steps.filter((s) => s.state !== "pending").map((s) => `${s.key}:${s.state}`);

type Process = { checkpointer: BaseCheckpointSaver; llm: GatedLlm; service: RunsService; tasks: Promise<void>[] };
function boot(checkpointer: BaseCheckpointSaver): Process {
  const llm = new GatedLlm();
  const events = new InProcessRunEvents();
  const tasks: Promise<void>[] = [];
  const graphRunner = makeGraphRunner(store, llm, llm, new FakeJobProfileCache(), events, checkpointer);
  const service = new RunsService({ store, config, graphRunner, events, runInBackground: (task) => void tasks.push(task()) });
  return { checkpointer, llm, service, tasks };
}
const settle = async (p: Process) => void (await Promise.all(p.tasks.splice(0)));
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let waited = 0; !condition(); waited += 5) {
    if (waited > 5000) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let cvFile: Buffer;
beforeEach(async () => {
  await store.deleteAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cvFile = (await renderPdf(layoutCv(longCv()), sizesForStep(0))).buffer;
});
afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

/** Starts a Run on the long CV and holds it in the reword call. */
async function heldInCondensing(p: Process): Promise<RunId> {
  p.llm.enqueue("extract_job_profile", job).enqueue("extract_cv", longExtracted).enqueueVoted("assess_coverage", coverage);
  const release = p.llm.hold("condense_reword");
  const id = await p.service.createRun({ cv: cvFile, jobDescription: "Platform engineer" });
  await until(() => p.llm.held.includes("condense_reword"), "the reword call");
  releases.set(p, release);
  return id;
}
const releases = new Map<Process, () => void>();

describe("the fit step", () => {
  it("is running while the CV is condensed (status tailoring), then done at review", async () => {
    const p = boot(createMemoryCheckpointer());
    const id = await heldInCondensing(p);

    const during = await p.service.getRunView(id);
    expect(during.status).toBe("tailoring");
    expect(states(during)).toEqual(["parse:done", "extract:done", "coverage:done", "questions:done", "tailor:done", "fit:running"]);

    p.llm.enqueue("condense_reword", { rewordings: [] }).enqueue("condense_drop", { drops: [] }, { drops: [] });
    releases.get(p)!();
    await settle(p);
    const after = await p.service.getRunView(id);
    expect(after.status).toBe("awaiting_review");
    expect(states(after)).toEqual(["parse:done", "extract:done", "coverage:done", "questions:done", "tailor:done", "fit:done", "review:running"]);
  });

  it("is done at once when the CV needed no condensing", async () => {
    const p = boot(createMemoryCheckpointer());
    p.llm.enqueue("extract_job_profile", job).enqueue("extract_cv", { ...longExtracted, experience: longExtracted.experience.slice(0, 1) }).enqueueVoted("assess_coverage", coverage);
    const id = await p.service.createRun({ cv: cvFile, jobDescription: "Platform engineer" });
    await settle(p);
    const view = await p.service.getRunView(id);
    expect(view.status).toBe("awaiting_review");
    expect(states(view)).toContain("fit:done");
    expect(p.llm.calls.filter((c) => c.name.startsWith("condense"))).toEqual([]);
  });

  it("is the failed step of an interrupted Run that was cut off while condensing", async () => {
    const before = boot(createMemoryCheckpointer());
    const id = await heldInCondensing(before);
    expect(await store.claimRecovery(id, "tailoring")).toBe(true);
    const after = boot(before.checkpointer);
    await after.service.recoverRuns(STARTED_AT);
    const view = await after.service.getRunView(id);
    expect(view.status).toBe("interrupted");
    expect(states(view)).toEqual(["parse:done", "extract:done", "coverage:done", "questions:done", "tailor:done", "fit:failed"]);
  });
});
