import { describe, expect, it } from "vitest";
import { mergeRoundIntoChanges } from "@/tailoring/mergeChanges.js";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { change, testCv } from "./testCv.js";

const replace = (id: string, target: string, before: string, after: string, requirementIds = ["req1"]) =>
  change({ id, op: "replace", targetItemId: target, before, after, requirementIds });

describe("mergeRoundIntoChanges", () => {
  it("appends a Change on an Item that has none", () => {
    const kept = [replace("r1.c1", "exp1.b1", "orig", "one")];
    const round = [replace("r2.c1", "exp1.b2", "orig2", "two")];
    expect(mergeRoundIntoChanges(testCv(), kept, round).map((c) => c.id)).toEqual(["r1.c1", "r2.c1"]);
  });

  it("a Change on an Item that already has one replaces it, keeping the earlier ID and original before, and merging Requirements", () => {
    const kept = [replace("r1.c1", "exp1.b1", "original text", "first", ["req1", "req2"])];
    const round = [replace("r2.c1", "exp1.b1", "first", "second", ["req2", "req3"])];
    const merged = mergeRoundIntoChanges(testCv(), kept, round);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "r1.c1", op: "replace", targetItemId: "exp1.b1", before: "original text", after: "second", requirementIds: ["req1", "req2", "req3"] });
  });

  it("keeps one reorder per list, the latest wins and keeps the earlier ID", () => {
    const kept = [change({ id: "r1.c1", op: "reorder", parentId: "skills", orderedItemIds: ["skill2", "skill1", "skill3"] })];
    const round = [change({ id: "r2.c1", op: "reorder", parentId: "skills", orderedItemIds: ["skill3", "skill2", "skill1"] })];
    const merged = mergeRoundIntoChanges(testCv(), kept, round);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "r1.c1", orderedItemIds: ["skill3", "skill2", "skill1"] });
  });

  it("reorders of different lists both stay", () => {
    const kept = [change({ id: "r1.c1", op: "reorder", parentId: "skills", orderedItemIds: ["skill2", "skill1", "skill3"] })];
    const round = [change({ id: "r2.c1", op: "reorder", parentId: "exp1", orderedItemIds: ["exp1.b2", "exp1.b1"] })];
    expect(mergeRoundIntoChanges(testCv(), kept, round)).toHaveLength(2);
  });

  it("a replace of an Item an earlier round added becomes a new version of that add", () => {
    const cv = testCv();
    const kept = [change({ id: "r1.c1", op: "add", parentId: "skills", after: "Postgres", requirementIds: ["req1"] })];
    // The add became skill4; the tailor sets before to "" for it.
    const round = [replace("r2.c1", "skill4", "", "PostgreSQL", ["req2"])];
    const merged = mergeRoundIntoChanges(cv, kept, round);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: "r1.c1", op: "add", parentId: "skills", after: "PostgreSQL", requirementIds: ["req1", "req2"] });
    expect(applyChanges(cv, merged).skills.map((s) => [s.id, s.text]).at(-1)).toEqual(["skill4", "PostgreSQL"]);
  });

  it("keeps the position of an add that was reworded, so later Item IDs do not shift", () => {
    const cv = testCv();
    const kept = [
      change({ id: "r1.c1", op: "add", parentId: "skills", after: "A" }),
      change({ id: "r1.c2", op: "add", parentId: "skills", after: "B" }),
    ];
    const round = [replace("r2.c1", "skill4", "", "A2")];
    const merged = mergeRoundIntoChanges(cv, kept, round);
    expect(merged.map((c) => c.id)).toEqual(["r1.c1", "r1.c2"]);
    expect(applyChanges(cv, merged).skills.map((s) => [s.id, s.text]).slice(-2)).toEqual([["skill4", "A2"], ["skill5", "B"]]);
  });

  it("does not mutate its inputs", () => {
    const kept = [replace("r1.c1", "exp1.b1", "o", "first")];
    const snapshot = structuredClone(kept);
    mergeRoundIntoChanges(testCv(), kept, [replace("r2.c1", "exp1.b1", "first", "second")]);
    expect(kept).toEqual(snapshot);
  });
});

describe("mergeRoundIntoChanges remove", () => {
  const remove = (id: string, target: string, before = "orig") =>
    change({ id, op: "remove", targetItemId: target, before, evidenceIds: [], requirementIds: [] });

  it("appends a remove of an Item with no Change", () => {
    const kept = [replace("r1.c1", "exp1.b1", "orig", "one")];
    const merged = mergeRoundIntoChanges(testCv(), kept, [remove("r2.c1", "exp1.b2")]);
    expect(merged.map((c) => [c.id, c.op])).toEqual([["r1.c1", "replace"], ["r2.c1", "remove"]]);
  });

  it("a remove of a replaced Item takes the replace's place, keeping its ID and original before", () => {
    const kept = [replace("r1.c1", "exp1.b1", "original text", "first"), replace("r1.c2", "exp1.b2", "o2", "x")];
    const merged = mergeRoundIntoChanges(testCv(), kept, [remove("r2.c1", "exp1.b1", "first")]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: "r1.c1", op: "remove", targetItemId: "exp1.b1", before: "original text" });
  });

  it("keeps the IDs of added Items stable across a remove", () => {
    const add = change({ id: "r1.c1", op: "add", parentId: "exp1", after: "New", evidenceIds: ["exp1.b1"] });
    const merged = mergeRoundIntoChanges(testCv(), [add], [remove("r2.c1", "exp1.b2")]);
    expect(applyChanges(testCv(), merged).experience[0]!.bullets.map((b) => b.id)).toEqual(["exp1.b1", "exp1.b3"]);
  });

  it("does not repeat a remove of an already removed Item", () => {
    const kept = [remove("r1.c1", "exp1.b2")];
    expect(mergeRoundIntoChanges(testCv(), kept, [remove("r2.c1", "exp1.b2")]).map((c) => c.id)).toEqual(["r1.c1"]);
  });
});