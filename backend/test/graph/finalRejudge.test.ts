import { Command } from "@langchain/langgraph";
import { describe, expect, it } from "vitest";
import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import { buildRunGraph } from "@/graph/runGraph.js";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { keptChanges } from "@/tailoring/review.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { FakeJobProfileCache } from "../fakes/jobProfileCache.js";
import { longCv, longCvText, longExtracted } from "../fixtures/longCv.js";
import { extractedJob } from "../runFixtures.js";

// The final re-judge after Review: which Requirements are judged again once the user has rejected Changes or dropped bullets.

const job = {
  ...extractedJob,
  requirements: [
    { text: "Kubernetes", source: "Kubernetes", kind: "skill", importance: "must_have" },
    { text: "Event pipelines", source: "event pipelines", kind: "skill", importance: "must_have" },
    { text: "Mentoring", source: "mentoring", kind: "skill", importance: "nice_to_have" },
  ],
};
const verdict = (requirementId: string, v: "met" | "unmet", evidenceIds: string[]) => ({ requirementId, reason: "r", evidenceIds, verdict: v });
/** req1 cites exp1.b1, req2 cites exp1.b3, req3 cites exp1.b4. */
const ALL_MET = { verdicts: [verdict("req1", "met", ["exp1.b1"]), verdict("req2", "met", ["exp1.b3"]), verdict("req3", "met", ["exp1.b4"])] };
const cv = longCv();

function setup(judge: FakeLlmClient) {
  const llm = new FakeLlmClient().enqueue("extract_cv", longExtracted);
  judge.enqueue("extract_job_profile", job);
  const graph = buildRunGraph({ llm, judgeLlm: judge, judgeModel: "test-judge", jobProfileCache: new FakeJobProfileCache(), checkpointer: createMemoryCheckpointer(), onEnter: async () => {} });
  const config = { configurable: { thread_id: "run-1" }, durability: "sync" as const };
  return {
    start: () => graph.invoke({ runId: "run-1", cvText: longCvText(), jobDescriptionText: "Platform engineer" }, config),
    resume: (value: unknown) => graph.invoke(new Command({ resume: value }), config),
  };
}
const coverageCalls = (judge: FakeLlmClient) => judge.calls.filter((c) => c.name === "assess_coverage");
const promptOf = (call: { messages: { content: string }[] }) => call.messages.map((m) => m.content).join("\n");
const acceptAll = (changes: { id: string }[]) => changes.map((c) => ({ changeId: c.id, decision: "accept" }));

describe("final_rejudge", () => {
  it("judges again the Requirement that cites a bullet the user dropped, against the CV without it", async () => {
    const judge = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ALL_MET)
      .enqueue("condense_reword", { rewordings: [] })
      .enqueue("condense_drop", { drops: [] }, { drops: [] })
      .enqueueVoted("assess_coverage", { verdicts: [verdict("req1", "unmet", [])] });
    const run = setup(judge);
    const paused = await run.start();
    expect(coverageCalls(judge)).toHaveLength(3);

    const done = await run.resume({ decisions: acceptAll(paused.changes), drops: ["exp1.b1"] });
    const rejudge = coverageCalls(judge).slice(3);
    expect(rejudge).toHaveLength(3);
    const prompt = promptOf(rejudge[0]!);
    expect(prompt).toContain("[req1]");
    for (const other of ["[req2]", "[req3]"]) expect(prompt).not.toContain(other);
    expect(prompt).not.toContain("[exp1.b1]");
    expect(done.coverage!.map((c) => c.verdict)).toEqual(["unmet", "met", "met"]);
    expect(done.scoreAfter).toBeLessThan(done.scoreBefore!);
  });

  it("shows a drop in the completed CV: the bullet is gone, and the drop is a revised remove of the original text", async () => {
    const judge = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ALL_MET)
      .enqueue("condense_reword", { rewordings: [] })
      .enqueue("condense_drop", { drops: [] }, { drops: [] })
      .enqueueVoted("assess_coverage", { verdicts: [verdict("req3", "met", ["exp1.b5"])] });
    const run = setup(judge);
    const paused = await run.start();
    const done = await run.resume({ decisions: acceptAll(paused.changes), drops: ["exp1.b4", "exp2.b3"] });
    const drops = done.changes.filter((c) => c.id.startsWith("ud."));
    expect(drops.map((c) => [c.id, c.op, c.status])).toEqual([["ud.c1", "remove", "revised"], ["ud.c2", "remove", "revised"]]);
    expect(drops[0]).toMatchObject({ targetItemId: "exp1.b4", before: cv.experience[0]!.bullets[3]!.text });
    const finalCv = applyChanges(done.cv!, keptChanges(done.changes));
    expect(finalCv.experience[0]!.bullets.map((b) => b.id)).toEqual(["exp1.b1", "exp1.b2", "exp1.b3", "exp1.b5"]);
    expect(finalCv.experience[1]!.bullets.map((b) => b.id)).toEqual(["exp2.b1", "exp2.b2", "exp2.b4", "exp2.b5"]);
    // exp1.b4 was cited by req3, so req3 alone was judged again; exp2.b3 was not cited.
    expect(promptOf(coverageCalls(judge)[3]!)).toContain("[req3]");
  });

  it("judges again the Requirements that cite the Item of a rejected condense reword, though the Change lists none", async () => {
    const judge = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ALL_MET)
      .enqueue("condense_reword", { rewordings: [{ targetItemId: "exp1.b3", text: "Introduced load testing into the release process." }] })
      .enqueue("claim_check", { verdicts: [{ id: "cd1.c1", reason: "r", verdict: "supported" }] })
      .enqueue("condense_drop", { drops: [] }, { drops: [] })
      // The condense re-judge (req2 cites the reworded bullet), then the final one.
      .enqueueVoted("assess_coverage", { verdicts: [verdict("req2", "met", ["exp1.b3"])] }, { verdicts: [verdict("req2", "unmet", [])] });
    const run = setup(judge);
    const paused = await run.start();
    expect(paused.changes.map((c) => c.id)).toEqual(["cd1.c1"]);
    expect(coverageCalls(judge)).toHaveLength(6);

    const done = await run.resume({ decisions: [{ changeId: "cd1.c1", decision: "reject" }], drops: [] });
    const last = coverageCalls(judge).slice(6);
    expect(last).toHaveLength(3);
    expect(promptOf(last[0]!)).toContain("[req2]");
    for (const other of ["[req1]", "[req3]"]) expect(promptOf(last[0]!)).not.toContain(other);
    expect(done.coverage!.map((c) => c.verdict)).toEqual(["met", "unmet", "met"]);
  });

  it("makes no model call when the user undid nothing and dropped nothing", async () => {
    const judge = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ALL_MET)
      .enqueue("condense_reword", { rewordings: [] })
      .enqueue("condense_drop", { drops: [] }, { drops: [] });
    const run = setup(judge);
    const paused = await run.start();
    await run.resume({ decisions: acceptAll(paused.changes), drops: [] });
    expect(coverageCalls(judge)).toHaveLength(3);
  });
});
