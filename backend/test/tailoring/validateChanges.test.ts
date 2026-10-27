import { CoverageSchema } from "@resume-ai/shared";
import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import type { Cv } from "@resume-ai/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fitOf } from "@/export/index.js";
import { STAGE1_REASONS } from "@/tailoring/stage1Checks.js";
import { validateChanges } from "@/tailoring/validateChanges.js";
import { longCv } from "../export/exportCv.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { change, testCv } from "./testCv.js";

const original = testCv();
const ok = change({ id: "r1.c1", op: "replace", targetItemId: "exp1.b1", before: "Built the backend for the orders service in Express", after: "Built the orders backend in Express and Node", evidenceIds: ["exp1.b1"] });
const add = change({ id: "r1.c2", op: "add", parentId: "skills", after: "Postgres", evidenceIds: ["exp2.b1"] });
const badTarget = change({ id: "r1.c3", op: "replace", targetItemId: "nope", before: "", after: "x", evidenceIds: ["exp1.b1"] });
const reorder = change({ id: "r1.c4", op: "reorder", parentId: "skills", orderedItemIds: ["skill2", "skill1", "skill3"], evidenceIds: ["skill1"] });
const verdict = (id: string, v: "supported" | "not_supported", reason = "r") => ({ id, reason, verdict: v });
const run = (llm: FakeLlmClient, changes = [ok, add, badTarget, reorder]) =>
  validateChanges(llm, { original, draft: original, changes, round: 1, coverage: [] });

describe("validateChanges", () => {
  it("claim-checks only what passed stage 1, with Evidence resolved to the original text and no reorder", async () => {
    const llm = new FakeLlmClient().enqueue("claim_check", { verdicts: [verdict("r1.c1", "supported"), verdict("r1.c2", "supported")] });
    const result = await run(llm);

    expect(llm.calls).toHaveLength(1);
    const prompt = llm.calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("[r1.c1]");
    expect(prompt).toContain("[r1.c2]");
    expect(prompt).not.toContain("r1.c3");
    expect(prompt).not.toContain("r1.c4");
    expect(prompt).toContain("- Built the backend for the orders service in Express");
    expect(prompt).toContain("- Wrote internal tools");
    expect(result.valid.map((c) => c.id)).toEqual(["r1.c1", "r1.c2", "r1.c4"]);
    expect(result.rejections).toMatchObject([{ round: 1, stage: "stage1", change: { id: "r1.c3" } }]);
  });

  it("records a claim-check rejection with the model's reason and leaves the Change out", async () => {
    const llm = new FakeLlmClient().enqueue("claim_check", { verdicts: [verdict("r1.c1", "not_supported", "Node is new"), verdict("r1.c2", "supported")] });
    const result = await run(llm);
    expect(result.valid.map((c) => c.id)).toEqual(["r1.c2", "r1.c4"]);
    expect(result.rejections.map((r) => [r.change.id, r.stage, r.reason])).toEqual([
      ["r1.c3", "stage1", expect.any(String)],
      ["r1.c1", "claim_check", "Node is new"],
    ]);
  });

  it("makes no claim-check call when nothing needs one", async () => {
    const llm = new FakeLlmClient();
    const result = await run(llm, [badTarget, reorder]);
    expect(llm.calls).toHaveLength(0);
    expect(result.valid.map((c) => c.id)).toEqual(["r1.c4"]);
  });
});

describe("validate span", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  beforeAll(() => provider.register());
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });
  beforeEach(() => exporter.reset());

  it("records the round and counts, with claim_check nested under it", async () => {
    const llm = new FakeLlmClient().enqueue("claim_check", { verdicts: [verdict("r1.c1", "supported"), verdict("r1.c2", "not_supported", "SECRET-REASON")] });
    await run(llm);
    const spans = exporter.getFinishedSpans();
    const validate = spans.find((s) => s.name === "validate")!;
    const claim = spans.find((s) => s.name === "claim_check")!;
    expect(validate.attributes).toMatchObject({ round: 1, "validate.changes": 4, "validate.stage1_rejected": 1, "validate.claim_rejected": 1, "validate.valid": 2 });
    expect(claim.attributes["round"]).toBe(1);
    expect(claim.parentSpanContext?.spanId).toBe(validate.spanContext().spanId);
    expect(JSON.stringify(validate.attributes)).not.toContain("SECRET");
  });
});

describe("validateChanges with User Evidence", () => {
  const userEvidence = [{ id: "ue1", questionId: "q1", requirementId: "req1", text: "Ran 12 clusters at Acme." }] as never;
  const fromAnswer = change({ id: "r1.c1", op: "add", parentId: "exp1", after: "Ran 12 clusters at Acme", evidenceIds: ["ue1"] });

  it("hands the claim check the Answer text as the user's own statement and applies a supported Change", async () => {
    const llm = new FakeLlmClient().enqueue("claim_check", { verdicts: [verdict("r1.c1", "supported")] });
    const result = await validateChanges(llm, { original, draft: original, changes: [fromAnswer], round: 1, coverage: [], userEvidence });
    const prompt = llm.calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("The user's own statements");
    expect(prompt).toContain("- Ran 12 clusters at Acme.");
    expect(result.valid).toEqual([fromAnswer]);
  });

  it("rejects a Change citing User Evidence when the claim check does not support it", async () => {
    const llm = new FakeLlmClient().enqueue("claim_check", { verdicts: [verdict("r1.c1", "not_supported", "scale is new")] });
    const result = await validateChanges(llm, { original, draft: original, changes: [fromAnswer], round: 1, coverage: [], userEvidence });
    expect(result.rejections).toMatchObject([{ stage: "claim_check", reason: "scale is new" }]);
  });
});

describe("validateChanges remove", () => {
  it("passes a valid remove without a claim check, and rejects one that cites Coverage", async () => {
    const remove = change({ id: "r1.c1", op: "remove", targetItemId: "exp1.b2", before: "x", evidenceIds: [], requirementIds: [] });
    const llm = new FakeLlmClient();
    const free = await validateChanges(llm, { original, draft: original, changes: [remove], round: 1, coverage: [] });
    expect(llm.calls).toHaveLength(0);
    expect(free.valid).toEqual([remove]);

    const coverage = [CoverageSchema.parse({ requirementId: "req1", verdict: "partially_met", evidenceIds: ["exp1.b2"], reason: "r" })];
    const held = await validateChanges(new FakeLlmClient(), { original, draft: original, changes: [remove], round: 1, coverage });
    expect(held.valid).toEqual([]);
    expect(held.rejections).toMatchObject([{ stage: "stage1", reason: STAGE1_REASONS.notRemovable }]);
  });
});

describe("validateChanges page check on adds", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  beforeAll(() => provider.register());
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });
  beforeEach(() => exporter.reset());

  const sentence = "Delivered a feature for the team, reducing manual work and keeping the service reliable under load for customers.";
  const supported = (...ids: string[]) => ({ verdicts: ids.map((id) => verdict(id, "supported")) });
  const addTo = (id: string, after: string) => change({ id, op: "add", parentId: "exp1", after, evidenceIds: ["exp1.b1"] });

  /** The longest made-up CV (one extra job) that still fits one page, with `spare` fewer bullets so there is room left. */
  async function nearEdge(spare: number): Promise<Cv> {
    let n = 1;
    while ((await fitOf(longCv(1, n + 1))).fits) n += 1;
    return longCv(1, n - spare);
  }
  const validate = (cv: Cv, llm: FakeLlmClient, changes: ReturnType<typeof change>[]) =>
    validateChanges(llm, { original: cv, draft: cv, changes, round: 1, coverage: [] });

  it("rejects an add that tips a CV that fits over one page, with the reason recorded as a stage 1 rejection", async () => {
    const cv = await nearEdge(0);
    const big = addTo("r1.c1", `${sentence} ${sentence} ${sentence}`);
    const result = await validate(cv, new FakeLlmClient().enqueue("claim_check", supported("r1.c1")), [big]);
    expect(result.valid).toEqual([]);
    expect(result.rejections).toMatchObject([{ round: 1, stage: "stage1", reason: STAGE1_REASONS.pastOnePage, change: { id: "r1.c1" } }]);
    expect(STAGE1_REASONS.pastOnePage).toBe("The Change would push the CV past one page.");
  });

  it("rejects the last proposed add first and keeps the earlier one when that is enough", async () => {
    const cv = await nearEdge(2);
    const small = addTo("r1.c1", sentence);
    const big = addTo("r1.c2", `${sentence} ${sentence} ${sentence} ${sentence}`);
    const result = await validate(cv, new FakeLlmClient().enqueue("claim_check", supported("r1.c1", "r1.c2")), [small, big]);
    expect(result.valid.map((c) => c.id)).toEqual(["r1.c1"]);
    expect(result.rejections).toMatchObject([{ stage: "stage1", reason: STAGE1_REASONS.pastOnePage, change: { id: "r1.c2" } }]);
  });

  it("rejects an add the draft could not hold even alone, and keeps replaces and reorders of the same round", async () => {
    const cv = await nearEdge(0);
    const big = addTo("r1.c1", `${sentence} ${sentence} ${sentence}`);
    const reword = change({ id: "r1.c2", op: "replace", targetItemId: "exp1.b1", before: sentence, after: "Delivered a feature for the team.", evidenceIds: ["exp1.b1"] });
    const result = await validate(cv, new FakeLlmClient().enqueue("claim_check", supported("r1.c1", "r1.c2")), [big, reword]);
    expect(result.valid.map((c) => c.id)).toEqual(["r1.c2"]);
    expect(result.rejections.map((r) => r.change.id)).toEqual(["r1.c1"]);
  });

  it("blocks no add for length when the draft was already over one page", async () => {
    const cv = longCv(4, 6);
    expect((await fitOf(cv)).fits).toBe(false);
    const add1 = addTo("r1.c1", sentence);
    const result = await validate(cv, new FakeLlmClient().enqueue("claim_check", supported("r1.c1")), [add1]);
    expect(result.valid).toEqual([add1]);
    expect(result.rejections).toEqual([]);
  });

  it("does not measure the fit when the round has no add", async () => {
    const fit = vi.fn(fitOf);
    const llm = new FakeLlmClient().enqueue("claim_check", supported("r1.c1"));
    const result = await validateChanges(llm, { original, draft: original, changes: [ok, reorder], round: 1, coverage: [], fit });
    expect(fit).not.toHaveBeenCalled();
    expect(result.valid.map((c) => c.id)).toEqual(["r1.c1", "r1.c4"]);
  });

  it("records how many adds the page check rejected on the validate span", async () => {
    const cv = await nearEdge(0);
    const big = addTo("r1.c1", `${sentence} ${sentence} ${sentence}`);
    await validate(cv, new FakeLlmClient().enqueue("claim_check", supported("r1.c1")), [big]);
    const span = exporter.getFinishedSpans().find((s) => s.name === "validate")!;
    expect(span.attributes).toMatchObject({ "validate.rejected_past_page": 1, "validate.stage1_rejected": 0, "validate.valid": 0 });
  });

  it("measures twice for a round that fits (before, then with the Changes) and does not measure for an add that stage 1 rejected", async () => {
    const fit = vi.fn(fitOf);
    const good = change({ id: "r1.c1", op: "add", parentId: "skills", after: "Postgres", evidenceIds: ["exp2.b1"] });
    await validateChanges(new FakeLlmClient().enqueue("claim_check", supported("r1.c1")), { original, draft: original, changes: [good], round: 1, coverage: [], fit });
    expect(fit).toHaveBeenCalledTimes(2);

    fit.mockClear();
    const bad = change({ id: "r1.c2", op: "add", parentId: "nope", after: "x", evidenceIds: ["exp2.b1"] });
    await validateChanges(new FakeLlmClient(), { original, draft: original, changes: [bad], round: 1, coverage: [], fit });
    expect(fit).not.toHaveBeenCalled();
  });

  it("lets an error from the fit check fail the round", async () => {
    const good = change({ id: "r1.c1", op: "add", parentId: "skills", after: "Postgres", evidenceIds: ["exp2.b1"] });
    const llm = new FakeLlmClient().enqueue("claim_check", supported("r1.c1"));
    await expect(validateChanges(llm, { original, draft: original, changes: [good], round: 1, coverage: [], fit: async () => Promise.reject(new Error("render failed")) })).rejects.toThrow("render failed");
  });
});
