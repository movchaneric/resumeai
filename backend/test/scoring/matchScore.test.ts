import { describe, expect, it } from "vitest";
import { CoverageSchema, RequirementSchema } from "@resume-ai/shared";
import type { Coverage, CoverageVerdict, Importance, Requirement } from "@resume-ai/shared";
import { matchScore } from "@/scoring/matchScore.js";

const req = (id: string, importance: Importance): Requirement =>
  RequirementSchema.parse({ id, text: id, source: id, kind: "skill", importance });
const cov = (requirementId: string, verdict: CoverageVerdict): Coverage =>
  CoverageSchema.parse({ requirementId, verdict, evidenceIds: [], reason: "r" });

describe("matchScore", () => {
  const requirements = [
    req("req1", "must_have"),
    req("req2", "must_have"),
    req("req3", "must_have"),
    req("req4", "nice_to_have"),
    req("req5", "nice_to_have"),
  ];

  it("scores the decisions example as 50", () => {
    const coverage = [
      cov("req1", "met"),
      cov("req2", "partially_met"),
      cov("req3", "unmet"),
      cov("req4", "met"),
      cov("req5", "unmet"),
    ];
    expect(matchScore(requirements, coverage)).toBe(50);
  });

  it("scores 100 when everything is met", () => {
    expect(matchScore(requirements, requirements.map((r) => cov(r.id, "met")))).toBe(100);
  });

  it("scores 0 when everything is unmet", () => {
    expect(matchScore(requirements, requirements.map((r) => cov(r.id, "unmet")))).toBe(0);
  });

  it("counts a Requirement with no verdict as unmet", () => {
    const coverage = [cov("req1", "met"), cov("req2", "met"), cov("req3", "met"), cov("req4", "met")];
    expect(matchScore(requirements, coverage)).toBeCloseTo((100 * 10) / 11, 10);
  });

  it("returns the score unrounded", () => {
    const coverage = [cov("req1", "met")];
    expect(matchScore(requirements, coverage)).toBeCloseTo(27.2727272727, 8);
  });
});
