import { describe, expect, it } from "vitest";
import { RequirementSchema } from "@resume-ai/shared";
import type { Cv, Requirement, RequirementKind } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";
import {
  CLAIM_DOWNGRADE_REASON,
  applyClaimRule,
  collectItemIds,
  coverageIssues,
} from "@/scoring/coverageRules.js";
import type { CoverageAnswer } from "@/scoring/coverageRules.js";
import { CoverageError } from "@/scoring/errors.js";
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

describe("collectItemIds", () => {
  it("collects every Item and bullet ID", () => {
    expect([...collectItemIds(cv())].sort()).toEqual(
      [
        "contact", "summary", "exp1", "exp1.b1", "exp1.b2", "exp2", "exp2.b1", "edu1", "edu1.b1",
        "skill1", "skill2", "proj1", "proj1.b1", "cert1", "sec1.i1", "sec1.i2",
      ].sort(),
    );
  });
});

describe("coverageIssues", () => {
  const requirements = [req("req1"), req("req2")];

  it("gives no issues for a clean answer", () => {
    const answer: CoverageAnswer = {
      verdicts: [verdict("req1", "met", ["exp1.b1"]), verdict("req2", "unmet", [])],
    };
    expect(coverageIssues(requirements, cv(), answer)).toEqual([]);
  });

  it("flags a Requirement with no verdict", () => {
    const answer: CoverageAnswer = { verdicts: [verdict("req1", "unmet", [])] };
    expect(coverageIssues(requirements, cv(), answer)).toEqual(["req2: has no verdict"]);
  });

  it("flags a Requirement with two verdicts", () => {
    const answer: CoverageAnswer = {
      verdicts: [verdict("req1", "unmet", []), verdict("req1", "unmet", []), verdict("req2", "unmet", [])],
    };
    expect(coverageIssues(requirements, cv(), answer)).toEqual(["req1: has 2 verdicts, expected one"]);
  });

  it("flags a verdict for an unknown Requirement", () => {
    const answer: CoverageAnswer = {
      verdicts: [verdict("req1", "unmet", []), verdict("req2", "unmet", []), verdict("req9", "unmet", [])],
    };
    expect(coverageIssues(requirements, cv(), answer)).toEqual(["req9: is not a Requirement in the list"]);
  });

  it("flags an Evidence ID that is not in the CV", () => {
    const answer: CoverageAnswer = {
      verdicts: [verdict("req1", "met", ["exp9.b1"]), verdict("req2", "unmet", [])],
    };
    expect(coverageIssues(requirements, cv(), answer)).toEqual(["req1: Evidence ID exp9.b1 does not exist in the CV"]);
  });

  it("rejects a section ID as Evidence but accepts its items", () => {
    const answer: CoverageAnswer = {
      verdicts: [verdict("req1", "met", ["sec1"]), verdict("req2", "met", ["sec1.i1"])],
    };
    expect(coverageIssues(requirements, cv(), answer)).toEqual(["req1: Evidence ID sec1 does not exist in the CV"]);
  });

  it("flags met and partially_met with no Evidence, but not unmet", () => {
    const answer: CoverageAnswer = {
      verdicts: [verdict("req1", "met", []), verdict("req2", "partially_met", [])],
    };
    expect(coverageIssues(requirements, cv(), answer)).toEqual([
      "req1: met but cites no Evidence",
      "req2: partially_met but cites no Evidence",
    ]);
  });
});

describe("applyClaimRule", () => {
  it("downgrades met with only a skills Claim to partially met with the fixed reason", () => {
    const { coverage, downgrades } = applyClaimRule([req("req1")], { verdicts: [verdict("req1", "met", ["skill2"])] });
    expect(coverage).toEqual([
      { requirementId: "req1", verdict: "partially_met", evidenceIds: ["skill2"], reason: CLAIM_DOWNGRADE_REASON },
    ]);
    expect(downgrades).toBe(1);
  });

  it("downgrades met that cites only Claims, summary included", () => {
    const { coverage } = applyClaimRule([req("req1")], { verdicts: [verdict("req1", "met", ["summary", "skill1"])] });
    expect(coverage[0]!.verdict).toBe("partially_met");
  });

  it("keeps met when a Claim is cited with an experience bullet", () => {
    const { coverage, downgrades } = applyClaimRule([req("req1")], {
      verdicts: [verdict("req1", "met", ["skill2", "exp1.b1"])],
    });
    expect(coverage[0]).toMatchObject({ verdict: "met", reason: "model reason" });
    expect(downgrades).toBe(0);
  });

  it("keeps met on a language Requirement that cites only the summary", () => {
    const { coverage, downgrades } = applyClaimRule([req("req1", "language")], {
      verdicts: [verdict("req1", "met", ["summary"])],
    });
    expect(coverage[0]!.verdict).toBe("met");
    expect(downgrades).toBe(0);
  });

  it("keeps met that cites an additional-section Item", () => {
    const { coverage } = applyClaimRule([req("req1")], { verdicts: [verdict("req1", "met", ["sec1.i1"])] });
    expect(coverage[0]!.verdict).toBe("met");
  });

  it("keeps met that cites the contact", () => {
    const { coverage } = applyClaimRule([req("req1")], { verdicts: [verdict("req1", "met", ["contact"])] });
    expect(coverage[0]!.verdict).toBe("met");
  });

  it("does not touch partially_met or unmet", () => {
    const { coverage, downgrades } = applyClaimRule([req("req1"), req("req2")], {
      verdicts: [verdict("req1", "partially_met", ["skill1"]), verdict("req2", "unmet", [])],
    });
    expect(coverage.map((c) => c.verdict)).toEqual(["partially_met", "unmet"]);
    expect(coverage[0]!.reason).toBe("model reason");
    expect(downgrades).toBe(0);
  });

  it("clears Evidence on an unmet verdict and keeps its verdict and reason", () => {
    const { coverage, downgrades } = applyClaimRule([req("req1")], {
      verdicts: [verdict("req1", "unmet", ["exp1"], "not shown")],
    });
    expect(coverage).toEqual([{ requirementId: "req1", verdict: "unmet", evidenceIds: [], reason: "not shown" }]);
    expect(downgrades).toBe(0);
  });

  it("leaves an unmet verdict with no Evidence unchanged", () => {
    const { coverage } = applyClaimRule([req("req1")], { verdicts: [verdict("req1", "unmet", [], "not shown")] });
    expect(coverage).toEqual([{ requirementId: "req1", verdict: "unmet", evidenceIds: [], reason: "not shown" }]);
  });

  it("counts downgrades and returns Coverage in Requirement order", () => {
    const requirements = [req("req1"), req("req2"), req("req3")];
    const { coverage, downgrades } = applyClaimRule(requirements, {
      verdicts: [
        verdict("req3", "met", ["skill1"]),
        verdict("req1", "met", ["skill2"]),
        verdict("req2", "met", ["exp1"]),
      ],
    });
    expect(coverage.map((c) => c.requirementId)).toEqual(["req1", "req2", "req3"]);
    expect(downgrades).toBe(2);
  });
});

describe("CoverageError", () => {
  it("carries its issues", () => {
    const error = new CoverageError("bad", ["req1: has no verdict"]);
    expect(error.name).toBe("CoverageError");
    expect(error.issues).toEqual(["req1: has no verdict"]);
    expect(error).toBeInstanceOf(Error);
  });
});
