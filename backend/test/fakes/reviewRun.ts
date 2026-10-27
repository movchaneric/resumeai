import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createApp } from "@/app.js";
import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import { RunsService } from "@/services/runs.js";
import type { RunStore } from "@/stores/runs.js";
import type { Config } from "@/utils/config.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import type { RunId } from "@resume-ai/shared";
import { extractedCv, extractedJob } from "../runFixtures.js";
import { GatedLlm } from "./gatedLlm.js";
import { FakeJobProfileCache } from "./jobProfileCache.js";
import { makeGraphRunner } from "./runGraph.js";

// A Run that reaches Review with three proposed Changes, for the tests of the Review (made-up content only).

const cvFile = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));

export const REVIEW_JOB = {
  ...extractedJob,
  requirements: [
    { text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" },
    { text: "PostgreSQL", source: "PostgreSQL", kind: "skill", importance: "must_have" },
    { text: "Docker", source: "Docker", kind: "skill", importance: "nice_to_have" },
  ],
};

const verdictFor = (requirementId: string, verdict: "met" | "unmet") => ({
  requirementId,
  reason: "r",
  evidenceIds: verdict === "met" ? ["exp1.b1"] : [],
  verdict,
});
export const FIRST_COVERAGE = { verdicts: [verdictFor("req1", "met"), verdictFor("req2", "unmet"), verdictFor("req3", "unmet")] };
export const ALL_MET = { verdicts: [verdictFor("req1", "met"), verdictFor("req2", "met"), verdictFor("req3", "met")] };
export const only = (requirementId: string, verdict: "met" | "unmet") => ({ verdicts: [verdictFor(requirementId, verdict)] });

const modelChange = (over: Record<string, unknown>) => ({
  op: "replace",
  targetItemId: null,
  parentId: null,
  text: null,
  orderedItemIds: null,
  evidenceIds: ["exp1.b1"],
  requirementIds: ["req2"],
  rationale: "Closer to the Requirement",
  ...over,
});
/** r1.c1 rewords a bullet (req2), r1.c2 adds a skill (req3), r1.c3 reorders the skills (req1). */
const PROPOSED = [
  modelChange({ targetItemId: "exp1.b1", text: "Designed and maintained Node.js services backed by PostgreSQL databases." }),
  modelChange({ op: "add", parentId: "skills", text: "Docker", requirementIds: ["req3"] }),
  modelChange({ op: "reorder", parentId: "skills", orderedItemIds: ["skill2", "skill1"], requirementIds: ["req1"] }),
];
export const CHANGE_IDS = ["r1.c1", "r1.c2", "r1.c3"];

/** The model calls up to Review: extraction, first Coverage, one kept round (all Requirements met), then nothing more to propose. */
export function enqueueToReview(llm: GatedLlm): void {
  llm
    .enqueue("extract_job_profile", REVIEW_JOB)
    .enqueue("extract_cv", extractedCv)
    .enqueueVoted("assess_coverage", FIRST_COVERAGE)
    .enqueue("tailor", { changes: PROPOSED })
    // A reorder states nothing, so only the replace and the add are claim-checked.
    .enqueue("claim_check", { verdicts: CHANGE_IDS.slice(0, 2).map((id) => ({ id, reason: "r", verdict: "supported" })) })
    .enqueueVoted("assess_coverage", ALL_MET)
    .enqueue("tailor", { changes: [] }, { changes: [] });
}

/** How many `assess_coverage` calls the Run makes before Review: the first Coverage and the round's re-judge. */
export const COVERAGE_CALLS_BEFORE_REVIEW = 2 * 3;

export function bootReview(store: RunStore, config: Config, checkpointer: BaseCheckpointSaver = createMemoryCheckpointer(), now?: () => Date) {
  const llm = new GatedLlm();
  const events = new InProcessRunEvents();
  const tasks: Promise<void>[] = [];
  const graphRunner = makeGraphRunner(store, llm, llm, new FakeJobProfileCache(), events, checkpointer);
  const deps = { store, config, graphRunner, events, now, runInBackground: (task: () => Promise<void>) => void tasks.push(task()) };
  const service = new RunsService(deps);
  const settle = async () => {
    await Promise.all(tasks.splice(0));
  };
  return { llm, service, app: createApp(deps, service), settle, checkpointer, runner: graphRunner };
}
export type ReviewProcess = ReturnType<typeof bootReview>;

/** Creates a Run and lets it reach Review (it pauses for Answers on the way; they are skipped). */
export async function reachReview(process: ReviewProcess): Promise<RunId> {
  enqueueToReview(process.llm);
  const id = await process.service.createRun({ cv: cvFile, jobDescription: "We are hiring a backend developer with Node.js experience." });
  await process.settle();
  await process.service.submitAnswers(id, { answers: [] });
  await process.settle();
  return id;
}

export const acceptAll = () => CHANGE_IDS.map((changeId) => ({ changeId, decision: "accept" }));
/** The decisions for every Change: accept, except for the ones in `over` (by Change ID). */
export const decisions = (over: Record<string, Record<string, unknown>> = {}) =>
  CHANGE_IDS.map((changeId) => ({ changeId, decision: "accept", ...over[changeId] }));
