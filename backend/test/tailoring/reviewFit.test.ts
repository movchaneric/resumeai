import { describe, expect, it } from "vitest";
import type { Change } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";
import { fitOf } from "@/export/fit.js";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { minimalCv, reviewFit } from "@/tailoring/reviewFit.js";
import { longCv, longExtracted } from "../fixtures/longCv.js";
import { change, testCv } from "./testCv.js";

const cv = longCv();
const accept = (changes: Change[]) => changes.map((c) => ({ changeId: c.id, decision: "accept" as const }));
const bulletIds = (id: string) => [...cv.experience, ...cv.education, ...cv.projects].find((p) => p.id === id)!.bullets.map((b) => b.id);
/** Every bullet of the long CV except the first of each entry: dropping them all leaves the shortest CV the user can submit. */
const allButFirst = [...cv.experience, ...cv.education, ...cv.projects].flatMap((p) => p.bullets.slice(1).map((b) => b.id));

describe("minimalCv", () => {
  it("cuts every entry to one bullet, its shortest, measured on the reworded text", () => {
    const reword = change({ id: "cd1.c1", op: "replace", targetItemId: "exp2.b2", before: "x", after: "Cut cloud costs.", evidenceIds: ["exp2.b2"], requirementIds: [] });
    const minimal = minimalCv(cv, [reword]);
    for (const entry of [...minimal.experience, ...minimal.education, ...minimal.projects]) expect(entry.bullets).toHaveLength(1);
    expect(minimal.experience[1]!.bullets.map((b) => b.id)).toEqual(["exp2.b2"]);
    expect(minimal.experience[1]!.bullets[0]!.text).toBe("Cut cloud costs.");
  });

  it("applies every Change but an add: removes and reorders count, an added bullet never stays", () => {
    const small = testCv();
    const add = change({ id: "r1.c1", op: "add", parentId: "exp1", after: "A", evidenceIds: ["exp1.b1"] });
    const remove = change({ id: "r1.c2", op: "remove", targetItemId: "exp1.b2", before: "x", evidenceIds: [], requirementIds: [] });
    const reorder = change({ id: "r1.c3", op: "reorder", parentId: "skills", orderedItemIds: ["skill3", "skill2", "skill1"] });
    const minimal = minimalCv(small, [add, remove, reorder]);
    expect(minimal.experience[0]!.bullets.map((b) => b.id)).toEqual(["exp1.b1"]);
    expect(minimal.skills.map((s) => s.id)).toEqual(["skill3", "skill2", "skill1"]);
  });

  it("leaves an entry that had no bullets without one", () => {
    expect(minimalCv(cv, []).education[0]!.bullets).toHaveLength(1);
    const bare = assignCvIds({ ...longExtracted, education: [{ ...longExtracted.education[0]!, bullets: [] }] });
    expect(minimalCv(bare, []).education[0]!.bullets).toEqual([]);
  });
});

describe("reviewFit", () => {
  it("reports how far over the submission is, and that the minimal CV fits", async () => {
    expect((await fitOf(cv)).fits).toBe(false);
    const result = await reviewFit(cv, [], [], []);
    expect(result).toMatchObject({ fits: false, fittable: true });
    expect((result as { overByLines: number }).overByLines).toBeGreaterThan(0);
  });

  it("reports the size step on a fit, with fittable true and no measuring of the minimal CV", async () => {
    const result = await reviewFit(cv, [], [], allButFirst as never);
    expect(result).toMatchObject({ fits: true, fittable: true });
    expect(typeof (result as { step: number }).step).toBe("number");
  });

  it("builds the CV from the decisions: an accepted remove plus the drops fit, and without the drops the CV is over", async () => {
    const remove = change({ id: "cd2.c1", op: "remove", targetItemId: "exp3.b2", before: "x", evidenceIds: [], requirementIds: [] });
    const dropsRest = allButFirst.filter((id) => id !== "exp3.b2");
    expect(await reviewFit(cv, [remove], accept([remove]), dropsRest as never)).toMatchObject({ fits: true });
    expect(await reviewFit(cv, [remove], accept([remove]), [])).toMatchObject({ fits: false, fittable: true });
    // A rejected remove is not applied: dropping its bullet is a drop like any other.
    expect(await reviewFit(cv, [remove], [{ changeId: remove.id, decision: "reject" }], allButFirst as never)).toMatchObject({ fits: true });
  });

  it("says fittable is false when even the minimal CV is too long", async () => {
    const huge = assignCvIds({ ...longExtracted, summary: "A long sentence about running platforms for many teams. ".repeat(160) });
    const result = await reviewFit(huge, [], [], []);
    expect(result).toMatchObject({ fits: false, fittable: false });
  });

  it("keeps the bullets listed in the fixture in step with this test's helper", () => {
    expect(bulletIds("exp1")).toHaveLength(5);
    expect(applyChanges(cv, []).experience).toHaveLength(6);
  });
});
