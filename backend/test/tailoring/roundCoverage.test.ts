import { describe, expect, it } from "vitest";
import { CoverageSchema, RequirementSchema } from "@resume-ai/shared";
import { mergeCoverage, requirementsListedBy } from "@/tailoring/roundCoverage.js";
import { change } from "./testCv.js";

const req = (id: string) => RequirementSchema.parse({ id, text: id, source: "s", kind: "skill", importance: "must_have" });
const cov = (requirementId: string, verdict: "met" | "unmet", reason = "old") =>
  CoverageSchema.parse({ requirementId, verdict, evidenceIds: [], reason });

describe("requirementsListedBy", () => {
  it("returns, in Job Profile order, only the Requirements some Change lists", () => {
    const changes = [change({ op: "add", parentId: "skills", after: "x", requirementIds: ["req3"] }), change({ op: "add", parentId: "skills", after: "y", requirementIds: ["req1", "req3"] })];
    expect(requirementsListedBy([req("req1"), req("req2"), req("req3")], changes).map((r) => r.id)).toEqual(["req1", "req3"]);
  });
});

describe("mergeCoverage", () => {
  it("replaces re-judged verdicts and carries over the rest, in the previous order", () => {
    const merged = mergeCoverage([cov("req1", "unmet"), cov("req2", "unmet")], [cov("req2", "met", "new")]);
    expect(merged).toEqual([cov("req1", "unmet"), cov("req2", "met", "new")]);
  });
});
