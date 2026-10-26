import { describe, expect, it } from "vitest";
import { CoverageSchema, RequirementSchema } from "@resume-ai/shared";
import type { CoverageVerdict, Importance, Requirement } from "@resume-ai/shared";
import { MAX_QUESTIONS, selectQuestions } from "@/tailoring/questions.js";

const req = (n: number, importance: Importance = "must_have", kind: Requirement["kind"] = "skill"): Requirement =>
  RequirementSchema.parse({ id: `req${n}`, text: `Thing ${n}`, source: `Thing ${n}`, kind, importance });
const verdict = (n: number, v: CoverageVerdict) => CoverageSchema.parse({ requirementId: `req${n}`, verdict: v, evidenceIds: [], reason: "r" });

describe("selectQuestions", () => {
  it("asks about unmet and partially met must-haves, with the template text", () => {
    const questions = selectQuestions([req(1), req(2), req(3)], [verdict(1, "unmet"), verdict(2, "met"), verdict(3, "partially_met")]);
    expect(questions).toEqual([
      { id: "q1", requirementId: "req1", text: "The job asks for: Thing 1. Have you done this? Describe where and how." },
      { id: "q2", requirementId: "req3", text: "The job asks for: Thing 3. Have you done this? Describe where and how." },
    ]);
  });

  it("does not double the full stop when the Requirement text already ends in one", () => {
    const requirement = RequirementSchema.parse({ id: "req1", text: "Thing 1. ", source: "Thing 1.", kind: "skill", importance: "must_have" });
    expect(selectQuestions([requirement], [verdict(1, "unmet")])[0]?.text).toBe("The job asks for: Thing 1. Have you done this? Describe where and how.");
  });

  it("skips nice-to-haves", () => {
    expect(selectQuestions([req(1, "nice_to_have")], [verdict(1, "unmet")])).toEqual([]);
  });

  it("asks nothing when every must-have is met", () => {
    expect(selectQuestions([req(1), req(2)], [verdict(1, "met"), verdict(2, "met")])).toEqual([]);
  });

  it("includes must-have soft skills and responsibilities", () => {
    const questions = selectQuestions([req(1, "must_have", "soft_skill"), req(2, "must_have", "responsibility")], [verdict(1, "unmet"), verdict(2, "unmet")]);
    expect(questions.map((q) => q.requirementId)).toEqual(["req1", "req2"]);
  });

  it("orders by weight, heaviest first, then by Requirement order", () => {
    const requirements = [req(1, "must_have", "soft_skill"), req(2), req(3, "must_have", "responsibility"), req(4)];
    const coverage = [1, 2, 3, 4].map((n) => verdict(n, "unmet"));
    expect(selectQuestions(requirements, coverage).map((q) => q.requirementId)).toEqual(["req2", "req4", "req1", "req3"]);
  });

  it("asks at most MAX_QUESTIONS, keeping the heaviest", () => {
    expect(MAX_QUESTIONS).toBe(5);
    const requirements = [req(1, "must_have", "soft_skill"), ...[2, 3, 4, 5, 6, 7].map((n) => req(n))];
    const coverage = requirements.map((_, i) => verdict(i + 1, "unmet"));
    const questions = selectQuestions(requirements, coverage);
    expect(questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4", "q5"]);
    expect(questions.map((q) => q.requirementId)).toEqual(["req2", "req3", "req4", "req5", "req6"]);
  });

  it("ignores a Requirement with no verdict", () => {
    expect(selectQuestions([req(1)], [])).toEqual([]);
  });
});
