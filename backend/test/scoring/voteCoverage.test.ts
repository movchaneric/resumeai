import { describe, expect, it } from "vitest";
import { RequirementSchema } from "@resume-ai/shared";
import { CoverageSchema } from "@resume-ai/shared";
import type { Coverage, CoverageVerdict } from "@resume-ai/shared";
import { COVERAGE_VOTES, voteCoverage } from "@/scoring/assessCoverage.js";

const req = (id: string) => RequirementSchema.parse({ id, text: `text ${id}`, source: "s", kind: "skill", importance: "must_have" });
const c = (requirementId: string, verdict: CoverageVerdict, evidenceIds: string[], reason = `reason ${verdict}`): Coverage =>
  CoverageSchema.parse({ requirementId, verdict, evidenceIds, reason });

describe("voteCoverage", () => {
  const requirements = [req("req1")];

  it("uses 3 votes by default", () => {
    expect(COVERAGE_VOTES).toBe(3);
  });

  it("keeps the majority verdict of 3 calls", () => {
    const voted = voteCoverage(
      [[c("req1", "met", ["a"])], [c("req1", "partially_met", ["b"])], [c("req1", "partially_met", ["c"])]],
      requirements,
    );
    expect(voted[0]!.verdict).toBe("partially_met");
  });

  it("gives partially_met when 3 calls all differ", () => {
    const voted = voteCoverage(
      [[c("req1", "met", ["a"])], [c("req1", "unmet", [])], [c("req1", "partially_met", ["b"])]],
      requirements,
    );
    expect(voted[0]!.verdict).toBe("partially_met");
  });

  it("takes evidence and reason from the first call that gave the winning verdict", () => {
    const voted = voteCoverage(
      [
        [c("req1", "met", ["a"], "first met")],
        [c("req1", "unmet", [], "unmet")],
        [c("req1", "met", ["z"], "second met")],
      ],
      requirements,
    );
    expect(voted[0]).toEqual({ requirementId: "req1", verdict: "met", evidenceIds: ["a"], reason: "first met" });
  });

  it("takes the lower verdict of 2 calls", () => {
    const voted = voteCoverage([[c("req1", "met", ["a"])], [c("req1", "partially_met", ["b"])]], requirements);
    expect(voted[0]).toMatchObject({ verdict: "partially_met", evidenceIds: ["b"] });
  });

  it("returns a single call unchanged", () => {
    const one = [c("req1", "met", ["a"])];
    expect(voteCoverage([one], requirements)).toEqual(one);
  });

  it("returns Requirement order, whatever order a call used", () => {
    const two = [req("req1"), req("req2")];
    const call = [c("req2", "unmet", []), c("req1", "met", ["a"])];
    expect(voteCoverage([call], two).map((x) => x.requirementId)).toEqual(["req1", "req2"]);
  });
});
