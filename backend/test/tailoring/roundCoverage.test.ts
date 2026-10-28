import { describe, expect, it } from "vitest";
import { CoverageSchema } from "@resume-ai/shared";
import { mergeCoverage } from "@/tailoring/roundCoverage.js";

const cov = (requirementId: string, verdict: "met" | "unmet", reason = "old") =>
  CoverageSchema.parse({ requirementId, verdict, evidenceIds: [], reason });

describe("mergeCoverage", () => {
  it("replaces re-judged verdicts and carries over the rest, in the previous order", () => {
    const merged = mergeCoverage([cov("req1", "unmet"), cov("req2", "unmet")], [cov("req2", "met", "new")]);
    expect(merged).toEqual([cov("req1", "unmet"), cov("req2", "met", "new")]);
  });
});
