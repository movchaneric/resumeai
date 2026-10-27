import { CoverageSchema } from "@resume-ai/shared";
import { describe, expect, it } from "vitest";
import { removableBullets } from "@/tailoring/removable.js";
import { change, testCv } from "./testCv.js";

const coverage = (verdict: "met" | "partially_met" | "unmet", evidenceIds: string[], requirementId = "req1") =>
  CoverageSchema.parse({ requirementId, verdict, evidenceIds, reason: "r" });
const remove = (targetItemId: string) => change({ op: "remove", targetItemId, before: "x", evidenceIds: [], requirementIds: [] });

describe("removableBullets", () => {
  it("lists the bullets of parents with more than one, leaving the first of a fully removable parent", () => {
    // exp1 has two bullets, every other parent one.
    expect([...removableBullets(testCv(), [], [])]).toEqual(["exp1.b2"]);
  });

  it("leaves out a bullet that a met or partially met Coverage cites, but not an unmet one", () => {
    const cv = testCv();
    expect([...removableBullets(cv, [coverage("met", ["exp1.b2"])], [])]).toEqual(["exp1.b1"]);
    expect([...removableBullets(cv, [coverage("partially_met", ["exp1.b2"])], [])]).toEqual(["exp1.b1"]);
    expect([...removableBullets(cv, [coverage("unmet", ["exp1.b2"])], [])]).toEqual(["exp1.b2"]);
    // the cited bullet stays; the free one may go
    expect([...removableBullets(cv, [coverage("met", ["exp1.b1"])], [])]).toEqual(["exp1.b2"]);
  });

  it("lists at most N - 1 bullets of a parent with N", () => {
    const cv = testCv();
    cv.experience[0]!.bullets.push({ id: "exp1.b3" as never, text: "Third" });
    expect([...removableBullets(cv, [], [])]).toEqual(["exp1.b2", "exp1.b3"]);
    expect([...removableBullets(cv, [coverage("met", ["exp1.b3"])], [])]).toEqual(["exp1.b1", "exp1.b2"]);
    expect([...removableBullets(cv, [coverage("met", ["exp1.b2", "exp1.b3"])], [])]).toEqual(["exp1.b1"]);
  });

  it("counts the removes already made: a parent with one bullet left contributes none", () => {
    expect([...removableBullets(testCv(), [], [remove("exp1.b2")])]).toEqual([]);
  });

  it("never lists a bullet a tailor `add` created, and an added bullet does not count as a bullet that stays", () => {
    const cv = testCv();
    const add = change({ op: "add", parentId: "exp2", after: "New", evidenceIds: ["exp1.b1"] });
    // exp2 now has b1 (original) and b2 (added): the added one never counts as staying, so the original one must stay.
    expect([...removableBullets(cv, [], [add])]).toEqual(["exp1.b2"]);
  });
});
