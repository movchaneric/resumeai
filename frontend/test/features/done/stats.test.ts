import { describe, expect, it } from "vitest";
import { doneStats, formatExpiry } from "@/features/done/stats";
import { runView } from "../../fixtures/runViews";

describe("formatExpiry", () => {
  it("formats the medium date in a fixed locale and zone", () => {
    expect(formatExpiry("2026-11-03T10:00:00.000Z", "en-GB", "UTC")).toBe("3 Nov 2026");
  });
});

describe("doneStats", () => {
  it("counts only kept rewordings and additions, and the met must-haves", () => {
    const base = { rationale: "r", evidenceIds: ["b1"], requirementIds: ["r1"] };
    const run = runView("completed", {
      changes: [
        { ...base, id: "c1", op: "replace", targetItemId: "b1", before: "a", after: "b", status: "accepted" },
        { ...base, id: "c2", op: "replace", targetItemId: "b1", before: "a", after: "b", status: "revised" },
        { ...base, id: "c3", op: "replace", targetItemId: "b1", before: "a", after: "b", status: "rejected" },
        { ...base, id: "c4", op: "add", parentId: "exp1", after: "x", status: "accepted" },
        { ...base, id: "c5", op: "add", parentId: "exp1", after: "x", status: "rejected" },
      ],
    });
    expect(doneStats(run)).toEqual({ rewordingsKept: 2, bulletsAdded: 1, mustHavesMet: 1, mustHaves: 1 });
  });
});
