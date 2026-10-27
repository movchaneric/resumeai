import { describe, expect, it } from "vitest";
import { applyChanges } from "./applyChanges.js";
import { applyDecisions, dropProblem, keptChanges, userDrops } from "./review.js";
import { change, testCv } from "./testCv.js";

const remove = change({ id: "r1.c1", op: "remove", targetItemId: "exp1.b2", before: "x", evidenceIds: [], requirementIds: [] });
const decide = (decision: "accept" | "reject" | "revise", after?: string) => [{ changeId: remove.id, decision, ...(after === undefined ? {} : { after }) }];

describe("user drops", () => {
  it("turns each drop into a revised remove Change with a fixed rationale and a new ID", () => {
    const drops = userDrops(testCv(), ["exp1.b2", "proj1.b1"] as never);
    expect(drops.map((c) => c.id)).toEqual(["ud.c1", "ud.c2"]);
    expect(drops[0]).toMatchObject({ op: "remove", targetItemId: "exp1.b2", before: "Cut build time by 40% for 3 services", status: "revised", evidenceIds: [], requirementIds: [], rationale: "Dropped by you in Review." });
  });
});

describe("applyDecisions with user drops", () => {
  it("keeps the drops with the kept Changes, so the Tailored CV loses the bullet", () => {
    const kept = keptChanges([...applyDecisions([remove], decide("reject")), ...userDrops(testCv(), ["exp1.b1"] as never)]);
    expect(applyChanges(testCv(), kept).experience[0]!.bullets.map((b) => b.id)).toEqual(["exp1.b2"]);
  });
});

describe("dropProblem", () => {
  it("accepts a drop of an original bullet and rejects one that would empty its entry", () => {
    const cv = testCv();
    expect(dropProblem(cv, [], [], ["exp1.b2"] as never)).toBeNull();
    expect(dropProblem(cv, [], [], ["exp2.b1"] as never)).toMatch(/exp2/);
    expect(dropProblem(cv, [], [], [])).toBeNull();
  });
});
