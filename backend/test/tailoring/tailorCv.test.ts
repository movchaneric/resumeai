import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CoverageSchema, RequirementSchema } from "@resume-ai/shared";
import type { Coverage, Cv, Requirement } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";
import { LlmSchemaError, LlmUnavailableError } from "@/llm/llmClient.js";
import { renderTailorInput } from "@/prompts/renderTailor.js";
import { TAILOR_SYSTEM_PROMPT, tailorCv } from "@/tailoring/tailorCv.js";
import { TailorError } from "@/tailoring/tailorErrors.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { fullCv } from "../extraction/cvFixture.js";

const original = (): Cv => assignCvIds(fullCv());
const req = (id: string): Requirement =>
  RequirementSchema.parse({ id, text: `text ${id}`, source: "s", kind: "skill", importance: "must_have" });
const cov = (requirementId: string, verdict: "met" | "partially_met" | "unmet"): Coverage =>
  CoverageSchema.parse({ requirementId, verdict, evidenceIds: verdict === "unmet" ? [] : ["exp1.b1"], reason: "why" });

const requirements = [req("req1"), req("req2")];
const coverage = [cov("req1", "partially_met"), cov("req2", "unmet")];

const input = (extra: Partial<Parameters<typeof tailorCv>[1]> = {}) => ({
  originalCv: original(),
  draftCv: original(),
  requirements,
  coverage,
  rejections: [],
  round: 1,
  ...extra,
});

/** A model Change with every field the model schema has. */
const m = (over: Record<string, unknown> = {}) => ({
  op: "replace",
  targetItemId: "exp1.b1",
  parentId: null,
  text: "Built a, reworded",
  orderedItemIds: null,
  evidenceIds: ["exp1.b1"],
  requirementIds: ["req1"],
  rationale: "Closer to the Requirement",
  ...over,
});
const answer = (...changes: unknown[]) => ({ changes });

describe("tailorCv", () => {
  it("turns a replace into a Change with a code-set id, the original text as before, and status proposed", async () => {
    const llm = new FakeLlmClient().enqueue("tailor", answer(m()));
    const result = await tailorCv(llm, input());

    expect(llm.calls).toHaveLength(1);
    expect(result.retries).toBe(0);
    expect(result.changes).toEqual([
      {
        id: "r1.c1",
        op: "replace",
        targetItemId: "exp1.b1",
        before: "Built a",
        after: "Built a, reworded",
        rationale: "Closer to the Requirement",
        evidenceIds: ["exp1.b1"],
        requirementIds: ["req1"],
        status: "proposed",
      },
    ]);
  });

  it("takes before from the original CV even when the draft already changed that Item", async () => {
    const draft = original();
    draft.experience[0]!.bullets[0]!.text = "Built a, earlier rewording";
    const llm = new FakeLlmClient().enqueue("tailor", answer(m()));
    const result = await tailorCv(llm, input({ draftCv: draft, round: 2 }));

    expect(result.changes[0]).toMatchObject({ id: "r2.c1", before: "Built a" });
  });

  it("maps add and reorder Changes", async () => {
    const llm = new FakeLlmClient().enqueue(
      "tailor",
      answer(
        m({ op: "add", targetItemId: null, parentId: "exp1", text: "New bullet" }),
        m({ op: "reorder", targetItemId: null, parentId: "skills", text: null, orderedItemIds: ["skill2", "skill1"] }),
      ),
    );
    const result = await tailorCv(llm, input());

    expect(result.changes).toMatchObject([
      { id: "r1.c1", op: "add", parentId: "exp1", after: "New bullet", status: "proposed" },
      { id: "r1.c2", op: "reorder", parentId: "skills", orderedItemIds: ["skill2", "skill1"], status: "proposed" },
    ]);
  });

  it("accepts an empty list", async () => {
    const llm = new FakeLlmClient().enqueue("tailor", answer());
    expect((await tailorCv(llm, input())).changes).toEqual([]);
  });

  it("sends the system prompt and the rendered input", async () => {
    const llm = new FakeLlmClient().enqueue("tailor", answer());
    const rejections: [] = [];
    await tailorCv(llm, input({ rejections }));

    const [system, user] = llm.calls[0]!.messages;
    expect(system).toEqual({ role: "system", content: TAILOR_SYSTEM_PROMPT });
    expect(user).toEqual({
      role: "user",
      content: renderTailorInput({ cv: original(), requirements, coverage, rejections }),
    });
  });

  it("states the strict rule in the system prompt", () => {
    expect(TAILOR_SYSTEM_PROMPT).toContain("states nothing the Evidence does not state");
    expect(TAILOR_SYSTEM_PROMPT).toContain("no new technologies, numbers, scope, roles or achievements");
  });

  it.each([
    ["no Evidence", m({ evidenceIds: [] }), "no Evidence"],
    ["no Requirements", m({ requirementIds: [] }), "no Requirement"],
    ["an unknown Requirement", m({ requirementIds: ["req9"] }), "req9"],
    ["an empty rationale", m({ rationale: "  " }), "rationale"],
    ["a replace with no target", m({ targetItemId: null }), "targetItemId"],
    ["a replace with no text", m({ text: null }), "text"],
    ["an add with no parent", m({ op: "add", targetItemId: null, parentId: null }), "parentId"],
    ["a reorder with no order", m({ op: "reorder", targetItemId: null, text: null }), "orderedItemIds"],
  ])("retries once on %s, listing the issue", async (_label, bad, fragment) => {
    const llm = new FakeLlmClient().enqueue("tailor", answer(bad), answer(m()));
    const result = await tailorCv(llm, input());

    expect(llm.calls).toHaveLength(2);
    expect(result.retries).toBe(1);
    const retry = llm.calls[1]!.messages;
    expect(retry.slice(0, 2)).toEqual(llm.calls[0]!.messages);
    expect(retry[retry.length - 1]!.role).toBe("user");
    expect(retry[retry.length - 1]!.content).toContain(fragment);
    expect(result.changes).toHaveLength(1);
  });

  it("retries when two Changes target the same Item", async () => {
    const llm = new FakeLlmClient().enqueue("tailor", answer(m(), m({ text: "other" })), answer(m()));
    await tailorCv(llm, input());
    expect(llm.calls[1]!.messages.at(-1)!.content).toContain("exp1.b1");
  });

  it("retries when two reorders target the same list", async () => {
    const reorder = m({ op: "reorder", targetItemId: null, parentId: "skills", text: null, orderedItemIds: ["skill1", "skill2"] });
    const llm = new FakeLlmClient().enqueue("tailor", answer(reorder, reorder), answer(reorder));
    await tailorCv(llm, input());
    expect(llm.calls[1]!.messages.at(-1)!.content).toContain("skills");
  });

  it("allows several adds under the same parent", async () => {
    const add = (text: string) => m({ op: "add", targetItemId: null, parentId: "exp1", text });
    const llm = new FakeLlmClient().enqueue("tailor", answer(add("one"), add("two")));
    const result = await tailorCv(llm, input());
    expect(llm.calls).toHaveLength(1);
    expect(result.changes).toHaveLength(2);
  });

  it("retries once after a schema error, listing its issues", async () => {
    const llm = new FakeLlmClient().enqueue("tailor", new LlmSchemaError("bad", ["changes.0: wrong"]), answer(m()));
    await tailorCv(llm, input());
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.messages.at(-1)!.content).toContain("changes.0: wrong");
  });

  it("throws TailorError with the issues after two failures", async () => {
    const llm = new FakeLlmClient().enqueue("tailor", answer(m({ evidenceIds: [] })), answer(m({ evidenceIds: [] })));
    const error = await tailorCv(llm, input()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TailorError);
    expect((error as TailorError).issues.join("\n")).toContain("no Evidence");
    expect(llm.calls).toHaveLength(2);
  });

  it("throws TailorError after two schema errors", async () => {
    const llm = new FakeLlmClient().enqueue(
      "tailor",
      new LlmSchemaError("bad", ["a: wrong"]),
      new LlmSchemaError("bad", ["b: wrong"]),
    );
    const error = await tailorCv(llm, input()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TailorError);
    expect((error as TailorError).issues).toEqual(["b: wrong"]);
  });

  it("does not retry LlmUnavailableError, on either attempt", async () => {
    const unavailable = new LlmUnavailableError("down");
    const first = new FakeLlmClient().enqueue("tailor", unavailable, answer(m()));
    await expect(tailorCv(first, input())).rejects.toBe(unavailable);
    expect(first.calls).toHaveLength(1);

    const second = new FakeLlmClient().enqueue("tailor", answer(m({ evidenceIds: [] })), unavailable);
    await expect(tailorCv(second, input())).rejects.toBe(unavailable);
  });
});

describe("tailor span", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  beforeAll(() => provider.register());
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });
  beforeEach(() => exporter.reset());

  it("records counts only", async () => {
    const llm = new FakeLlmClient().enqueue("tailor", answer(m({ evidenceIds: [] })), answer(m(), m({ targetItemId: "exp1.b2" })));
    await tailorCv(llm, input({ round: 2 }));

    const span = exporter.getFinishedSpans().find((s) => s.name === "tailor")!;
    expect(span.attributes["tailor.changes_proposed"]).toBe(2);
    expect(span.attributes["tailor.retries"]).toBe(1);
    expect(span.attributes["round"]).toBe(2);
    const dump = JSON.stringify(span.attributes);
    expect(dump).not.toContain("reworded");
    expect(dump).not.toContain("exp1.b1");
  });
});
