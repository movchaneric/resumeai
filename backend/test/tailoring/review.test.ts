import { describe, expect, it } from "vitest";
import { applyDecisions, keptChanges, reviewProblem } from "@/tailoring/review.js";
import { change, testCv } from "./testCv.js";

const remove = change({ id: "r1.c1", op: "remove", targetItemId: "exp1.b2", before: "x", evidenceIds: [], requirementIds: [] });
const decide = (decision: "accept" | "reject" | "revise", after?: string) => [{ changeId: remove.id, decision, ...(after === undefined ? {} : { after }) }];

describe("review of a remove", () => {
  it("accepts and rejects like any Change", () => {
    expect(reviewProblem(testCv(), [remove], decide("accept"), [])).toBeNull();
    expect(reviewProblem(testCv(), [remove], decide("reject"), [])).toBeNull();
    expect(keptChanges(applyDecisions([remove], decide("accept")))).toHaveLength(1);
    expect(keptChanges(applyDecisions([remove], decide("reject")))).toHaveLength(0);
  });

  it("cannot be revised", () => {
    expect(reviewProblem(testCv(), [remove], decide("revise", "new text"), [])).toMatch(/remove has no text to revise/);
    expect(reviewProblem(testCv(), [remove], decide("revise"), [])).toMatch(/remove has no text to revise/);
  });
});
