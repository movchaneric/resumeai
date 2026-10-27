import { CoverageSchema } from "@resume-ai/shared";
import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { STAGE1_REASONS } from "@/tailoring/stage1Checks.js";
import { validateChanges } from "@/tailoring/validateChanges.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { change, testCv } from "./testCv.js";

const original = testCv();
const ok = change({ id: "r1.c1", op: "replace", targetItemId: "exp1.b1", before: "Built the backend for the orders service in Express", after: "Built the orders backend in Express and Node", evidenceIds: ["exp1.b1"] });
const add = change({ id: "r1.c2", op: "add", parentId: "skills", after: "Postgres", evidenceIds: ["exp2.b1"] });
const badTarget = change({ id: "r1.c3", op: "replace", targetItemId: "nope", before: "", after: "x", evidenceIds: ["exp1.b1"] });
const reorder = change({ id: "r1.c4", op: "reorder", parentId: "skills", orderedItemIds: ["skill2", "skill1", "skill3"], evidenceIds: ["skill1"] });
const verdict = (id: string, v: "supported" | "not_supported", reason = "r") => ({ id, reason, verdict: v });
const run = (llm: FakeLlmClient, changes = [ok, add, badTarget, reorder]) =>
  validateChanges(llm, { original, draft: original, changes, round: 1 });

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
    const result = await validateChanges(llm, { original, draft: original, changes: [fromAnswer], round: 1, userEvidence });
    const prompt = llm.calls[0]!.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("The user's own statements");
    expect(prompt).toContain("- Ran 12 clusters at Acme.");
    expect(result.valid).toEqual([fromAnswer]);
  });

  it("rejects a Change citing User Evidence when the claim check does not support it", async () => {
    const llm = new FakeLlmClient().enqueue("claim_check", { verdicts: [verdict("r1.c1", "not_supported", "scale is new")] });
    const result = await validateChanges(llm, { original, draft: original, changes: [fromAnswer], round: 1, userEvidence });
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

    const unchecked = await validateChanges(new FakeLlmClient(), { original, draft: original, changes: [remove], round: 1 });
    expect(unchecked.valid).toEqual([]);

    const coverage = [CoverageSchema.parse({ requirementId: "req1", verdict: "partially_met", evidenceIds: ["exp1.b2"], reason: "r" })];
    const held = await validateChanges(new FakeLlmClient(), { original, draft: original, changes: [remove], round: 1, coverage });
    expect(held.valid).toEqual([]);
    expect(held.rejections).toMatchObject([{ stage: "stage1", reason: STAGE1_REASONS.notRemovable }]);
  });
});