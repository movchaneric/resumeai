import { describe, expect, it } from "vitest";
import { LlmSchemaError, LlmUnavailableError } from "@/llm/llmClient.js";
import { CLAIM_CHECK_SYSTEM_PROMPT, claimCheck, type ClaimCheckInput } from "@/tailoring/claimCheck.js";
import { ClaimCheckError } from "@/tailoring/claimCheckErrors.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";

const changes: ClaimCheckInput[] = [
  { id: "c1", before: "Built the backend for the orders service in Express", after: "Designed and built the REST API for the orders service in Express", evidence: ["Built the backend for the orders service in Express"] },
  { id: "c2", before: "", after: "Wrote Postgres migrations", evidence: ["Wrote Postgres migrations for billing"] },
];
const verdict = (id: string, v: "supported" | "not_supported", reason = "r") => ({ id, reason, verdict: v });
const good = { verdicts: [verdict("c1", "not_supported", "REST not stated"), verdict("c2", "supported")] };

describe("claimCheck", () => {
  it("returns supported ids and rejections with the model's reason, in one call", async () => {
    const llm = new FakeLlmClient().enqueue("claim_check", good);
    const result = await claimCheck(llm, changes);
    expect(llm.calls).toHaveLength(1);
    expect(result.supportedIds).toEqual(["c2"]);
    expect(result.rejections).toEqual([{ id: "c1", reason: "REST not stated" }]);
  });

  it("makes no call for an empty list", async () => {
    const llm = new FakeLlmClient();
    expect(await claimCheck(llm, [])).toEqual({ supportedIds: [], rejections: [] });
    expect(llm.calls).toHaveLength(0);
  });

  it("is blind: the prompt holds only before, after and Evidence, and the rule is in the system prompt", async () => {
    const llm = new FakeLlmClient().enqueue("claim_check", good);
    // Extra fields smuggled in at runtime must not reach the prompt.
    const smuggled = changes.map((c) => ({ ...c, rationale: "RATIONALE-XYZ", requirementText: "REQTEXT-XYZ", jobDescription: "JD-XYZ" }));
    await claimCheck(llm, smuggled);
    const messages = llm.calls[0]!.messages;
    const all = messages.map((m) => m.content).join("\n");
    for (const secret of ["RATIONALE-XYZ", "REQTEXT-XYZ", "JD-XYZ"]) expect(all).not.toContain(secret);
    expect(all).toContain("Designed and built the REST API");
    expect(all).toContain("Wrote Postgres migrations for billing");
    expect(messages[0]!.role).toBe("system");
    expect(messages[0]!.content).toBe(CLAIM_CHECK_SYSTEM_PROMPT);
    expect(CLAIM_CHECK_SYSTEM_PROMPT).toContain("reasonable inference");
    expect(CLAIM_CHECK_SYSTEM_PROMPT).toContain("plausible");
  });

  it.each([
    ["missing", { verdicts: [verdict("c1", "supported")] }, "c2"],
    ["duplicate", { verdicts: [verdict("c1", "supported"), verdict("c1", "supported"), verdict("c2", "supported")] }, "c1"],
    ["unknown", { verdicts: [verdict("c1", "supported"), verdict("c2", "supported"), verdict("zzz", "supported")] }, "zzz"],
  ])("retries once on a %s Change id, listing the issue", async (_n, bad, mention) => {
    const llm = new FakeLlmClient().enqueue("claim_check", bad, good);
    const result = await claimCheck(llm, changes);
    expect(llm.calls).toHaveLength(2);
    const retry = llm.calls[1]!.messages;
    expect(retry.slice(0, 2)).toEqual(llm.calls[0]!.messages);
    expect(retry[retry.length - 1]!.content).toContain(mention);
    expect(result.supportedIds).toEqual(["c2"]);
  });

  it("retries once on a schema error", async () => {
    const llm = new FakeLlmClient().enqueue("claim_check", new LlmSchemaError("bad", ["verdicts.0: wrong"]), good);
    await claimCheck(llm, changes);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.messages.at(-1)!.content).toContain("verdicts.0: wrong");
  });

  it("throws ClaimCheckError with issues after two failures", async () => {
    const llm = new FakeLlmClient().enqueue("claim_check", { verdicts: [] }, { verdicts: [] });
    const error = await claimCheck(llm, changes).catch((e) => e);
    expect(error).toBeInstanceOf(ClaimCheckError);
    expect(error.issues.length).toBeGreaterThan(0);
    expect(llm.calls).toHaveLength(2);
  });

  it("does not retry LlmUnavailableError", async () => {
    const unavailable = new LlmUnavailableError("down");
    const llm = new FakeLlmClient().enqueue("claim_check", unavailable, good);
    await expect(claimCheck(llm, changes)).rejects.toBe(unavailable);
    expect(llm.calls).toHaveLength(1);
  });
});
