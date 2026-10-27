import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "@langchain/langgraph";
import { context, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fitOf } from "@/export/fit.js";
import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import { buildRunGraph } from "@/graph/runGraph.js";
import { parseCv } from "@/parsing/parseCv.js";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { loadConfig } from "@/utils/config.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { FakeJobProfileCache } from "../fakes/jobProfileCache.js";
import { longCv, longCvText, longExtracted } from "../fixtures/longCv.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
beforeAll(() => provider.register());
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});
beforeEach(() => exporter.reset());

const job = {
  ...extractedJob,
  requirements: [
    { text: "Kubernetes", source: "Kubernetes", kind: "skill", importance: "must_have" },
    { text: "Event pipelines", source: "event pipelines", kind: "skill", importance: "must_have" },
    { text: "Mentoring", source: "mentoring", kind: "skill", importance: "nice_to_have" },
    { text: "Incident response", source: "incident response", kind: "skill", importance: "nice_to_have" },
  ],
};
const verdict = (requirementId: string, v: "met" | "partially_met" | "unmet", evidenceIds: string[]) => ({
  requirementId,
  reason: "r",
  evidenceIds,
  verdict: v,
});
/** Every Requirement met; exp1.b1, exp1.b2, exp1.b4 and exp1.b5 are cited as Evidence. */
const ALL_MET = {
  verdicts: [verdict("req1", "met", ["exp1.b1"]), verdict("req2", "met", ["exp1.b2"]), verdict("req3", "met", ["exp1.b4"]), verdict("req4", "met", ["exp1.b5"])],
};
/** The must-have req2 is not met, so the Run goes on to Questions and rounds. */
const ONE_UNMET = { verdicts: [ALL_MET.verdicts[0]!, verdict("req2", "unmet", []), ...ALL_MET.verdicts.slice(2)] };

const cv = longCv();
const originalText = (id: string) =>
  id === "summary" ? cv.summary!.text : [...cv.experience, ...cv.projects, ...cv.education].flatMap((p) => p.bullets).find((b) => b.id === id)!.text;
/** The first seven words: shorter, and the Items used here carry no numbers. */
const shortened = (id: string) => `${originalText(id).split(" ").slice(0, 7).join(" ")}.`;
/** Items that carry no number and no Requirement cites, so rewording them neither trips the number rule nor needs a re-judge. */
const REWORD_IDS = ["summary", "exp2.b1", "exp3.b1", "exp4.b1", "exp5.b1", "exp6.b1", "edu1.b1", "proj1.b1", "proj2.b1"];
const reword = (ids = REWORD_IDS) => ({ rewordings: ids.map((id) => ({ targetItemId: id, text: shortened(id) })) });
const supported = (pass: number, count: number) => ({
  verdicts: Array.from({ length: count }, (_, i) => ({ id: `cd${pass}.c${i + 1}`, reason: "r", verdict: "supported" })),
});
const drops = (ids: string[]) => ({ drops: ids.map((id) => ({ targetItemId: id, rationale: "Least relevant" })) });
/** Everything the drop menu offers for `ALL_MET`: exp1.b3, four bullets of every other job, and the second bullet of education and projects. */
const MENU = [
  "exp1.b3",
  ...["exp2", "exp3", "exp4", "exp5", "exp6"].flatMap((j) => [2, 3, 4, 5].map((n) => `${j}.b${n}`)),
  "edu1.b2",
  "proj1.b2",
  "proj2.b2",
  "proj2.b3",
];

function setup(judge: FakeLlmClient, { text = longCvText(), extracted = longExtracted, profile = job }: { text?: string; extracted?: unknown; profile?: unknown } = {}) {
  const entered: string[] = [];
  const llm = new FakeLlmClient().enqueue("extract_cv", extracted);
  judge.enqueue("extract_job_profile", profile);
  const graph = buildRunGraph({
    llm,
    judgeLlm: judge,
    judgeModel: "test-judge",
    jobProfileCache: new FakeJobProfileCache(),
    checkpointer: createMemoryCheckpointer(),
    onEnter: async (_runId, node) => void entered.push(node),
  });
  // "sync", as the runner does: each step is checkpointed before the next starts, so a resume reaches only the node that waits.
  const config = { configurable: { thread_id: "run-1" }, durability: "sync" as const };
  const start = () => graph.invoke({ runId: "run-1", cvText: text, jobDescriptionText: "Platform engineer" }, config);
  const resume = (value: unknown) => graph.invoke(new Command({ resume: value }), config);
  return { start, resume, entered };
}
const called = (judge: FakeLlmClient, name: string) => judge.calls.filter((c) => c.name === name).length;
const remaining = async (changes: Parameters<typeof applyChanges>[1]) => fitOf(applyChanges(cv, changes));

describe("condensing", () => {
  it("does nothing for a CV that fits: no model call and no status write", async () => {
    const judge = new FakeLlmClient().enqueueVoted("assess_coverage", coverageAnswer);
    const shortCv = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));
    const text = await parseCv(shortCv, loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k" }).limits);
    const { start, entered } = setup(judge, { text, extracted: extractedCv, profile: extractedJob });
    const state = await start();
    expect(state.changes).toEqual([]);
    expect(judge.calls.filter((c) => c.name.startsWith("condense"))).toEqual([]);
    expect(entered.some((n) => n.startsWith("condense"))).toBe(false);
    expect(state.condensed).toBe(true);
  });

  it("rewords and drops a too-long CV until it fits, keeping the original text in `before`", async () => {
    const judge = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ALL_MET)
      .enqueue("condense_reword", reword())
      .enqueue("claim_check", supported(1, REWORD_IDS.length))
      .enqueue("condense_drop", drops(MENU));
    const { start } = setup(judge);
    expect((await fitOf(cv)).fits).toBe(false);
    const state = await start();

    const removes = state.changes.filter((c) => c.op === "remove");
    const replaces = state.changes.filter((c) => c.op === "replace");
    expect(removes.length).toBeGreaterThan(0);
    expect(replaces.map((c) => c.targetItemId)).toEqual(REWORD_IDS);
    expect(replaces.every((c) => c.before === originalText(c.targetItemId))).toBe(true);
    expect(removes.every((c) => c.before === originalText(c.targetItemId))).toBe(true);
    const spans = exporter.getFinishedSpans();
    expect(spans.find((s) => s.name === "condense.reword")?.attributes["condense.fit_after"]).toBeGreaterThan(0);
    expect(spans.find((s) => s.name === "condense.drop")?.attributes["condense.fit_after"]).toBe(0);
    expect(await remaining(state.changes)).toEqual({ fits: true, step: expect.any(Number) });
    expect(called(judge, "condense_drop")).toBe(1);
    expect(state.changes.every((c) => c.status === "proposed")).toBe(true);
  });

  it("reaches review still over after one reword and two drops", async () => {
    const judge = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ALL_MET)
      .enqueue("condense_reword", reword())
      .enqueue("claim_check", supported(1, REWORD_IDS.length))
      .enqueue("condense_drop", drops(["exp3.b2"]), drops(["exp3.b3"]), drops(["exp3.b4"]));
    const { start } = setup(judge);
    const state = await start();
    expect(called(judge, "condense_reword")).toBe(1);
    expect(called(judge, "condense_drop")).toBe(2);
    expect(state.changes.filter((c) => c.op === "remove").map((c) => c.targetItemId)).toEqual(["exp3.b2", "exp3.b3"]);
    expect((await remaining(state.changes)).fits).toBe(false);
    expect(state.exitReason).toBe("target_reached");
  });

  it("condenses on the path that skips tailoring, and on the path through the Confirmed Gaps", async () => {
    const skipped = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ALL_MET)
      .enqueue("condense_reword", reword())
      .enqueue("claim_check", supported(1, REWORD_IDS.length))
      .enqueue("condense_drop", drops(MENU));
    const first = await setup(skipped).start();
    expect(first.exitReason).toBe("target_reached");
    expect(first.changes.some((c) => c.op === "remove")).toBe(true);

    const gaps = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ONE_UNMET)
      .enqueue("condense_reword", reword())
      .enqueue("claim_check", supported(1, REWORD_IDS.length))
      .enqueue("condense_drop", drops(MENU));
    const run = setup(gaps);
    await run.start();
    const second = await run.resume([{ kind: "no_experience", questionId: "q1" }]);
    expect(second.exitReason).toBe("ceiling");
    expect(second.rounds).toBe(0);
    expect(second.changes.some((c) => c.op === "remove")).toBe(true);
  });

  it("leaves the exit reason, the round count and the iterations as the router set them", async () => {
    const judge = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ONE_UNMET)
      .enqueue("tailor", { changes: [] }, { changes: [] })
      .enqueue("condense_reword", reword())
      .enqueue("claim_check", supported(1, REWORD_IDS.length))
      .enqueue("condense_drop", drops(MENU));
    const run = setup(judge);
    await run.start();
    const state = await run.resume([]);
    expect(state.exitReason).toBe("ceiling");
    expect(state.rounds).toBe(2);
    expect(called(judge, "tailor")).toBe(2);
    expect(state.changes.some((c) => c.op === "remove")).toBe(true);
    // Condensing never goes back to a round.
    expect(run.entered.filter((n) => n === "begin_round")).toHaveLength(2);
    expect(run.entered.at(-1)).toMatch(/^condense_/);
  });

  it("never removes a cited bullet or a job's last original bullet, whatever the model asks", async () => {
    const everything = ["exp1.b1", "exp1.b2", "exp1.b3", "exp1.b4", "exp1.b5", "exp2.b1", "exp2.b2", "exp2.b3", "exp2.b4", "exp2.b5"];
    const judge = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ALL_MET)
      .enqueue("condense_reword", reword([]))
      .enqueue("condense_drop", drops(everything), drops(everything));
    const state = await setup(judge).start();
    const removed = state.changes.filter((c) => c.op === "remove").map((c) => c.targetItemId);
    expect(removed).toEqual(["exp1.b3", "exp2.b2", "exp2.b3", "exp2.b4", "exp2.b5"]);
    const left = applyChanges(cv, state.changes);
    expect(left.experience[0]!.bullets.map((b) => b.id)).toEqual(["exp1.b1", "exp1.b2", "exp1.b4", "exp1.b5"]);
    expect(left.experience[1]!.bullets.map((b) => b.id)).toEqual(["exp2.b1"]);
  });

  it("judges again exactly the Requirements that cite an Item condensing reworded or removed", async () => {
    // exp1.b1 (req1) is reworded; exp1.b3 and exp2.b1 are not cited by anything; req1 slips to partially met.
    const judge = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ALL_MET)
      .enqueue("condense_reword", reword(["exp1.b1", "exp1.b3"]))
      .enqueue("claim_check", supported(1, 2))
      .enqueue("condense_drop", drops(MENU))
      .enqueueVoted("assess_coverage", { verdicts: [verdict("req1", "partially_met", ["exp1.b1"])] });
    const state = await setup(judge).start();
    const coverageCalls = judge.calls.filter((c) => c.name === "assess_coverage");
    expect(coverageCalls).toHaveLength(6);
    const prompt = coverageCalls.at(-1)!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("[req1]");
    for (const other of ["[req2]", "[req3]", "[req4]"]) expect(prompt).not.toContain(other);
    // The re-judged CV is the condensed one: the dropped bullets are gone from the prompt.
    expect(prompt).not.toContain("[exp3.b2]");
    expect(state.coverage!.map((c) => c.verdict)).toEqual(["partially_met", "met", "met", "met"]);
    expect(state.scoreAfter).toBeLessThan(state.scoreBefore!);
    // Kept regardless of score: nothing is undone.
    expect(state.changes.filter((c) => c.op === "remove").length).toBeGreaterThan(0);
  });

  it("skips the re-judge when no Requirement cites a touched Item", async () => {
    const judge = new FakeLlmClient()
      .enqueueVoted("assess_coverage", ALL_MET)
      .enqueue("condense_reword", reword(["exp2.b1"]))
      .enqueue("claim_check", supported(1, 1))
      .enqueue("condense_drop", drops(["exp3.b2"]), drops(["exp3.b3"]));
    const state = await setup(judge).start();
    expect(called(judge, "assess_coverage")).toBe(3);
    expect(state.scoreAfter).toBe(state.scoreBefore);
  });

  describe("when a model call fails", () => {
    it("goes on to review with the valid Changes so far, and flags the span", async () => {
      const judge = new FakeLlmClient()
        .enqueueVoted("assess_coverage", ALL_MET)
        .enqueue("condense_reword", reword())
        .enqueue("claim_check", supported(1, REWORD_IDS.length))
        .enqueue("condense_drop", new Error("429"));
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const state = await setup(judge).start();
        expect(state.changes.flatMap((c) => (c.op === "replace" ? [c.targetItemId] : []))).toEqual(REWORD_IDS);
        expect(state.changes.every((c) => c.op === "replace")).toBe(true);
        expect(state.exitReason).toBe("target_reached");
        expect(spy.mock.calls.flat().join("\n")).toContain("condensing stopped");
      } finally {
        spy.mockRestore();
      }
      const spans = exporter.getFinishedSpans();
      expect(spans.find((s) => s.name === "condense.drop")?.attributes["condense.failed"]).toBe(true);
      expect(spans.find((s) => s.name === "condense.reword")?.attributes["condense.fit_after"]).toBeGreaterThan(0);
    });

    it("keeps the verdicts as they were when the re-judge fails", async () => {
      const judge = new FakeLlmClient()
        .enqueueVoted("assess_coverage", ALL_MET)
        .enqueue("condense_reword", reword(["exp1.b1"]))
        .enqueue("claim_check", supported(1, 1))
        .enqueue("condense_drop", drops(["exp3.b2"]), drops(["exp3.b3"]));
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        // No answer queued for the re-judge: the fake throws.
        const state = await setup(judge).start();
        expect(state.coverage).toEqual(ALL_MET.verdicts.map((v) => expect.objectContaining(v)));
        expect(state.scoreAfter).toBe(state.scoreBefore);
        expect(state.changes.length).toBeGreaterThan(0);
      } finally {
        spy.mockRestore();
      }
    });
  });
});

describe("the long CV fixture", () => {
  it("is about a page and a half at the smallest size, and has several jobs with several bullets", async () => {
    expect(cv.experience.length).toBeGreaterThanOrEqual(4);
    expect(cv.experience.every((e) => e.bullets.length >= 4)).toBe(true);
    const fit = await fitOf(cv);
    expect(fit.fits).toBe(false);
  });
});
