import type { z } from "zod";
import { describe, expect, it } from "vitest";
import { RequirementSchema } from "@resume-ai/shared";
import type { Cv, Requirement, RequirementKind } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";
import { LlmSchemaError, LlmUnavailableError, type LlmClient, type LlmMessage } from "@/llm/llmClient.js";
import { renderCv, renderRequirements } from "@/prompts/renderCv.js";
import { assessCoverage, COVERAGE_SYSTEM_PROMPT, COVERAGE_VOTES } from "@/scoring/assessCoverage.js";
import { CLAIM_DOWNGRADE_REASON } from "@/scoring/coverageRules.js";
import { CoverageError } from "@/scoring/errors.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { fullCv } from "../extraction/cvFixture.js";

const cv = (): Cv => assignCvIds(fullCv());
const req = (id: string, kind: RequirementKind = "skill"): Requirement =>
  RequirementSchema.parse({ id, text: `text ${id}`, source: "s", kind, importance: "must_have" });
const verdict = (
  requirementId: string,
  v: "met" | "partially_met" | "unmet",
  evidenceIds: string[],
  reason = "model reason",
) => ({ requirementId, reason, evidenceIds, verdict: v });

const ONE = { votes: 1 }; // per-call behaviour: one call, no vote
const requirements = [req("req1"), req("req2")];
const good = {
  verdicts: [verdict("req1", "met", ["exp1.b1"]), verdict("req2", "unmet", [])],
};
const bad = { verdicts: [verdict("req1", "met", ["exp1.b1"])] }; // req2 has no verdict

describe("assessCoverage", () => {
  it("returns Coverage on a valid first answer with one call", async () => {
    const llm = new FakeLlmClient().enqueue("assess_coverage", good);
    const result = await assessCoverage(llm, cv(), requirements, ONE);

    expect(llm.calls).toHaveLength(1);
    expect(result.downgrades).toBe(0);
    expect(result.coverage).toEqual([
      { requirementId: "req1", verdict: "met", evidenceIds: ["exp1.b1"], reason: "model reason" },
      { requirementId: "req2", verdict: "unmet", evidenceIds: [], reason: "model reason" },
    ]);
  });

  it("retries once after a structural issue, listing the issues in the retry message", async () => {
    const llm = new FakeLlmClient().enqueue("assess_coverage", bad, good);
    const result = await assessCoverage(llm, cv(), requirements, ONE);

    expect(llm.calls).toHaveLength(2);
    const retry = llm.calls[1]!.messages;
    const last = retry[retry.length - 1]!;
    expect(last.role).toBe("user");
    expect(last.content).toContain("req2: has no verdict");
    expect(retry.slice(0, 2)).toEqual(llm.calls[0]!.messages);
    expect(result.coverage).toHaveLength(2);
  });

  it("retries once after a schema error", async () => {
    const llm = new FakeLlmClient().enqueue("assess_coverage", new LlmSchemaError("bad", ["verdicts.0: wrong"]), good);
    await assessCoverage(llm, cv(), requirements, ONE);

    expect(llm.calls).toHaveLength(2);
    const retry = llm.calls[1]!.messages;
    expect(retry[retry.length - 1]!.content).toContain("verdicts.0: wrong");
  });

  it("throws CoverageError with the issues after two structural failures", async () => {
    const llm = new FakeLlmClient().enqueue("assess_coverage", bad, bad);
    const error = await assessCoverage(llm, cv(), requirements, ONE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CoverageError);
    expect((error as CoverageError).issues).toContain("req2: has no verdict");
    expect(llm.calls).toHaveLength(2);
  });

  it("throws CoverageError after two schema errors", async () => {
    const llm = new FakeLlmClient().enqueue(
      "assess_coverage",
      new LlmSchemaError("bad", ["a: wrong"]),
      new LlmSchemaError("bad", ["b: wrong"]),
    );
    const error = await assessCoverage(llm, cv(), requirements, ONE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CoverageError);
    expect((error as CoverageError).issues).toEqual(["b: wrong"]);
  });

  it("does not retry LlmUnavailableError", async () => {
    const unavailable = new LlmUnavailableError("down");
    const llm = new FakeLlmClient().enqueue("assess_coverage", unavailable, good);

    await expect(assessCoverage(llm, cv(), requirements, ONE)).rejects.toBe(unavailable);
    expect(llm.calls).toHaveLength(1);
  });

  it("does not wrap LlmUnavailableError raised on the retry", async () => {
    const unavailable = new LlmUnavailableError("down");
    const llm = new FakeLlmClient().enqueue("assess_coverage", bad, unavailable);

    await expect(assessCoverage(llm, cv(), requirements, ONE)).rejects.toBe(unavailable);
  });

  it("applies and counts a Claim downgrade", async () => {
    const answer = { verdicts: [verdict("req1", "met", ["skill1"]), verdict("req2", "met", ["exp1"])] };
    const llm = new FakeLlmClient().enqueue("assess_coverage", answer);
    const result = await assessCoverage(llm, cv(), requirements, ONE);

    expect(result.downgrades).toBe(1);
    expect(result.coverage[0]).toMatchObject({ verdict: "partially_met", reason: CLAIM_DOWNGRADE_REASON });
    expect(result.coverage[1]).toMatchObject({ verdict: "met" });
  });

  it("returns Coverage in Requirement order, whatever order the model used", async () => {
    const answer = { verdicts: [verdict("req2", "unmet", []), verdict("req1", "met", ["exp1.b1"])] };
    const llm = new FakeLlmClient().enqueue("assess_coverage", answer);
    const result = await assessCoverage(llm, cv(), requirements, ONE);

    expect(result.coverage.map((c) => c.requirementId)).toEqual(["req1", "req2"]);
  });

  it("sends the system prompt and the rendered Requirements and CV", async () => {
    const llm = new FakeLlmClient().enqueue("assess_coverage", good);
    await assessCoverage(llm, cv(), requirements, ONE);

    const [system, user] = llm.calls[0]!.messages;
    expect(system).toEqual({ role: "system", content: COVERAGE_SYSTEM_PROMPT });
    expect(user!.role).toBe("user");
    expect(user!.content).toBe(`Requirements:\n${renderRequirements(requirements)}\n\nCV:\n${renderCv(cv())}`);
  });

  it("keeps the inference rule and the no-added-details rule in the system prompt", async () => {
    const llm = new FakeLlmClient().enqueue("assess_coverage", good);
    await assessCoverage(llm, cv(), requirements, ONE);

    const system = llm.calls[0]!.messages[0]!.content;
    expect(system).toContain("has to infer the Requirement");
    expect(system).toContain("at most \"partially_met\"");
    expect(system).toContain("Never add details that are not in them");
  });

  it("makes soft_skill Requirements binary in the system prompt", async () => {
    const llm = new FakeLlmClient().enqueue("assess_coverage", good);
    await assessCoverage(llm, cv(), requirements, ONE);

    const system = llm.calls[0]!.messages[0]!.content;
    expect(system).toContain("kind soft_skill");
    expect(system).toContain("Never use \"partially_met\" for them");
  });

  it("downgrades a partially_met soft skill to unmet and counts it", async () => {
    const soft = [RequirementSchema.parse({ id: "req1", text: "Ownership", source: "s", kind: "soft_skill", importance: "must_have" })];
    const llm = new FakeLlmClient().enqueue("assess_coverage", {
      verdicts: [{ requirementId: "req1", reason: "related", evidenceIds: ["exp1.b1"], verdict: "partially_met" }],
    });
    const result = await assessCoverage(llm, cv(), soft, ONE);

    expect(result.coverage[0]).toMatchObject({ verdict: "unmet", evidenceIds: [] });
    expect(result.downgrades).toBe(1);
    expect(llm.calls).toHaveLength(1);
  });

  describe("votes", () => {
    const answer = (r1: "met" | "partially_met" | "unmet", evidence = "exp1.b1") => ({
      verdicts: [verdict("req1", r1, r1 === "unmet" ? [] : [evidence], `reason ${r1} ${evidence}`), verdict("req2", "unmet", [])],
    });

    it("makes COVERAGE_VOTES calls by default and keeps the median verdict", async () => {
      const llm = new FakeLlmClient().enqueue("assess_coverage", answer("met"), answer("partially_met"), answer("partially_met"));
      const result = await assessCoverage(llm, cv(), requirements);

      expect(llm.calls).toHaveLength(COVERAGE_VOTES);
      expect(result.coverage[0]).toMatchObject({ verdict: "partially_met", reason: "reason partially_met exp1.b1" });
    });

    it("gives partially_met when the three calls all differ", async () => {
      const llm = new FakeLlmClient().enqueue("assess_coverage", answer("met"), answer("unmet"), answer("partially_met"));
      const result = await assessCoverage(llm, cv(), requirements);
      expect(result.coverage[0]!.verdict).toBe("partially_met");
    });

    it("takes the lower verdict with 2 calls", async () => {
      const llm = new FakeLlmClient().enqueue("assess_coverage", answer("met"), answer("partially_met"));
      const result = await assessCoverage(llm, cv(), requirements, { votes: 2 });
      expect(result.coverage[0]!.verdict).toBe("partially_met");
    });

    it("takes evidence and reason from the first call that gave the winning verdict", async () => {
      const llm = new FakeLlmClient().enqueue("assess_coverage", answer("met", "exp1.b1"), answer("unmet"), answer("met", "exp1.b2"));
      const result = await assessCoverage(llm, cv(), requirements);
      expect(result.coverage[0]).toEqual({
        requirementId: "req1",
        verdict: "met",
        evidenceIds: ["exp1.b1"],
        reason: "reason met exp1.b1",
      });
    });

    it("applies the Claim rule per call, before the vote, and sums the downgrades", async () => {
      const claim = { verdicts: [verdict("req1", "met", ["skill1"]), verdict("req2", "unmet", [])] };
      const llm = new FakeLlmClient().enqueue("assess_coverage", claim, claim, answer("met"));
      const result = await assessCoverage(llm, cv(), requirements);

      expect(result.downgrades).toBe(2);
      expect(result.coverage[0]).toMatchObject({ verdict: "partially_met", reason: CLAIM_DOWNGRADE_REASON });
    });

    it("still votes when one of three calls fails", async () => {
      const llm = new FakeLlmClient().enqueue("assess_coverage", new LlmUnavailableError("down"), answer("met"), answer("partially_met"));
      const result = await assessCoverage(llm, cv(), requirements);
      // Two answers left: the lower one.
      expect(result.coverage[0]!.verdict).toBe("partially_met");
    });

    it("rethrows the first call's error when two of three calls fail", async () => {
      const first = new LlmUnavailableError("first");
      const llm = new FakeLlmClient().enqueue("assess_coverage", first, new LlmUnavailableError("second"), answer("met"));
      await expect(assessCoverage(llm, cv(), requirements)).rejects.toBe(first);
    });

    it("rethrows a CoverageError unchanged when every call fails after its retry", async () => {
      const llm = new FakeLlmClient().enqueue("assess_coverage", bad, bad, bad, bad, bad, bad);
      const error = await assessCoverage(llm, cv(), requirements).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(CoverageError);
    });

    it("makes the calls in parallel", async () => {
      let started = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const llm: LlmClient = {
        async structured<T>(_schema: z.ZodType<T>, _messages: LlmMessage[]): Promise<T> {
          started += 1;
          if (started === COVERAGE_VOTES) release();
          await gate; // no call returns until all of them have started
          return good as T;
        },
      };
      const result = await assessCoverage(llm, cv(), requirements);
      expect(started).toBe(COVERAGE_VOTES);
      expect(result.coverage).toHaveLength(2);
    });
  });
});
