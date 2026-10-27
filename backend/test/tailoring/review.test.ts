import { describe, expect, it } from "vitest";
import type { Change, ReviewDecision } from "@resume-ai/shared";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { applyDecisions, keptChanges, reviewProblem, userDrops } from "@/tailoring/review.js";
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

describe("user drops", () => {
  const problem = (changes: Parameters<typeof reviewProblem>[1], decisions: Parameters<typeof reviewProblem>[2], drops: string[]) =>
    reviewProblem(testCv(), changes, decisions, [], drops as never);
  const replace = change({ id: "r1.c2", op: "replace", targetItemId: "exp1.b1", before: "x", after: "Built the orders backend in Express", evidenceIds: ["exp1.b1"] });
  const add = change({ id: "r1.c3", op: "add", parentId: "exp1", after: "Added a bullet", evidenceIds: ["exp1.b1"] });
  const decideAll = (decision: "accept" | "reject", ...changes: Change[]): ReviewDecision[] => changes.map((c) => ({ changeId: c.id, decision }));

  it("turns each drop into a revised remove Change with a fixed rationale and a new ID", () => {
    const drops = userDrops(testCv(), ["exp1.b2", "proj1.b1"] as never);
    expect(drops.map((c) => c.id)).toEqual(["ud.c1", "ud.c2"]);
    expect(drops[0]).toMatchObject({ op: "remove", targetItemId: "exp1.b2", before: "Cut build time by 40% for 3 services", status: "revised", evidenceIds: [], requirementIds: [], rationale: "Dropped by you in Review." });
  });

  it("accepts a drop of an original bullet, and none at all", () => {
    expect(problem([], [], ["exp1.b2"])).toBeNull();
    expect(problem([], [], [])).toBeNull();
  });
  it("rejects an unknown Item, and an Item that is not a bullet", () => {
    expect(problem([], [], ["exp9.b1"])).toMatch(/exp9\.b1/);
    expect(problem([], [], ["exp1"])).toMatch(/exp1.*not a bullet/);
    expect(problem([], [], ["skill1"])).toMatch(/skill1/);
    expect(problem([], [], ["sec1.i1"])).toMatch(/sec1\.i1/);
  });
  it("rejects a bullet the tailor added, naming the Item", () => {
    expect(problem([add], decideAll("accept", add), ["exp1.b3"])).toMatch(/exp1\.b3.*added/);
  });
  it("rejects a repeated drop", () => {
    expect(problem([], [], ["exp1.b2", "exp1.b2"])).toMatch(/exp1\.b2.*more than once/);
  });
  it("rejects a drop of a bullet an accepted remove already removes, but allows it when that remove is rejected", () => {
    expect(problem([remove], decide("accept"), ["exp1.b2"])).toMatch(/exp1\.b2.*already/);
    expect(problem([remove], decide("reject"), ["exp1.b2"])).toBeNull();
  });
  it("needs the replace of a dropped bullet to be rejected", () => {
    expect(problem([replace], decideAll("accept", replace), ["exp1.b1"])).toMatch(/exp1\.b1.*reject its Change/);
    expect(problem([replace], [{ changeId: replace.id, decision: "revise", after: "Built the orders backend in Express" }], ["exp1.b1"])).toMatch(/reject its Change/);
    expect(problem([replace], decideAll("reject", replace), ["exp1.b1"])).toBeNull();
  });
  it("leaves every entry that had bullets with at least one, naming the entry", () => {
    expect(problem([], [], ["exp1.b1", "exp1.b2"])).toMatch(/exp1/);
    expect(problem([], [], ["exp2.b1"])).toMatch(/exp2/);
    expect(problem([], [], ["edu1.b1"])).toMatch(/edu1/);
    expect(problem([], [], ["proj1.b1"])).toMatch(/proj1/);
  });
  it("counts a bullet the tailor added as staying, and an accepted remove as gone", () => {
    expect(problem([add], decideAll("accept", add), ["exp1.b1", "exp1.b2"])).toBeNull();
    expect(problem([add], decideAll("reject", add), ["exp1.b1", "exp1.b2"])).toMatch(/exp1/);
    expect(problem([remove], decide("accept"), ["exp1.b1"])).toMatch(/exp1/);
  });
});

describe("applyDecisions with user drops", () => {
  it("keeps the drops with the kept Changes, so the Tailored CV loses the bullet", () => {
    const kept = keptChanges([...applyDecisions([remove], decide("reject")), ...userDrops(testCv(), ["exp1.b1"] as never)]);
    expect(applyChanges(testCv(), kept).experience[0]!.bullets.map((b) => b.id)).toEqual(["exp1.b2"]);
  });
});
