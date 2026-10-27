import { describe, expect, it } from "vitest";
import { CoverageSchema, RequirementSchema } from "@resume-ai/shared";
import { mergeCoverage, requirementsAffectedByReview, requirementsListedBy } from "@/tailoring/roundCoverage.js";
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

describe("requirementsAffectedByReview", () => {
  const citing = (requirementId: string, evidenceIds: string[]) => CoverageSchema.parse({ requirementId, verdict: "met", evidenceIds, reason: "r" });
  const coverage = [citing("req1", ["exp1.b1"]), citing("req2", ["exp1.b2"]), citing("req3", ["exp2.b1"])];
  const reqs = [req("req1"), req("req2"), req("req3")];
  const remove = (targetItemId: string, status: "rejected" | "revised") => change({ op: "remove", targetItemId, before: "x", evidenceIds: [], requirementIds: [], status });

  it("is the Requirements an undone Change lists, in Job Profile order", () => {
    const undone = [change({ op: "add", parentId: "skills", after: "x", requirementIds: ["req3"], status: "rejected" })];
    expect(requirementsAffectedByReview(reqs, coverage, undone).map((r) => r.id)).toEqual(["req3"]);
  });
  it("adds the Requirements whose verdict cites an Item an undone replace or remove targets", () => {
    const undone = [remove("exp1.b2", "revised"), change({ op: "replace", targetItemId: "exp2.b1", before: "x", after: "y", requirementIds: [], status: "rejected" })];
    expect(requirementsAffectedByReview(reqs, coverage, undone).map((r) => r.id)).toEqual(["req2", "req3"]);
  });
  it("does not count a reorder or an add, which target no Item", () => {
    const undone = [change({ op: "reorder", parentId: "skills", orderedItemIds: ["exp1.b1"], requirementIds: [], status: "rejected" })];
    expect(requirementsAffectedByReview(reqs, coverage, undone)).toEqual([]);
  });
  it("lists a Requirement once when both rules find it", () => {
    const undone = [change({ op: "replace", targetItemId: "exp1.b1", before: "x", after: "y", requirementIds: ["req1"], status: "rejected" })];
    expect(requirementsAffectedByReview(reqs, coverage, undone).map((r) => r.id)).toEqual(["req1"]);
  });
});
