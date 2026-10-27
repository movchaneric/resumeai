import { describe, expect, it } from "vitest";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { STAGE1_REASONS, stage1Checks } from "@/tailoring/stage1Checks.js";
import { change, testCv } from "./testCv.js";

/** Runs stage 1 against the original CV, with no earlier Changes (the draft equals the original). */
function check(...changes: ReturnType<typeof change>[]) {
  const cv = testCv();
  return stage1Checks(cv, cv, changes);
}

function reasonFor(c: ReturnType<typeof change>) {
  const result = check(c);
  expect(result.passed).toEqual([]);
  expect(result.rejected).toHaveLength(1);
  return result.rejected[0]!.reason;
}

describe("stage1Checks structure", () => {
  it("passes valid Changes and keeps the rest apart", () => {
    const good = change({ op: "replace", targetItemId: "exp1.b1", before: "Built the backend for the orders service in Express", after: "Built the orders service backend in Express", evidenceIds: ["exp1.b1"] });
    const bad = change({ op: "replace", targetItemId: "nope", before: "", after: "x", evidenceIds: ["exp1.b1"] });
    const result = check(good, bad);
    expect(result.passed).toEqual([good]);
    expect(result.rejected).toEqual([{ change: bad, reason: STAGE1_REASONS.unknownTarget }]);
  });

  it("rejects an unknown target", () => {
    expect(reasonFor(change({ op: "replace", targetItemId: "exp9.b1", before: "", after: "x", evidenceIds: ["exp1.b1"] }))).toBe(STAGE1_REASONS.unknownTarget);
  });

  it("rejects a non-text target", () => {
    for (const id of ["contact", "sec1", "experience"]) {
      expect(reasonFor(change({ op: "replace", targetItemId: id, before: "", after: "x", evidenceIds: ["exp1.b1"] }))).toBe(STAGE1_REASONS.notTextItem);
    }
  });

  it("rejects every Change that targets the contact Item, headline included", () => {
    const cv = testCv();
    cv.contact.headline = "Backend engineer";
    const changes = [
      change({ op: "replace", targetItemId: "contact", before: "Backend engineer", after: "Principal architect", evidenceIds: ["exp1.b1"] }),
      change({ op: "add", parentId: "contact", after: "Principal architect", evidenceIds: ["exp1.b1"] }),
      change({ op: "reorder", parentId: "contact", orderedItemIds: ["contact"] }),
    ];
    for (const c of changes) {
      const result = stage1Checks(cv, cv, [c]);
      expect(result.passed).toEqual([]);
      expect(result.rejected).toHaveLength(1);
    }
  });

  it("rejects a protected target: a job, education or certification entry", () => {
    for (const id of ["exp1", "edu1", "cert1", "proj1"]) {
      expect(reasonFor(change({ op: "replace", targetItemId: id, before: "", after: "x", evidenceIds: ["exp1.b1"] }))).toBe(STAGE1_REASONS.protectedField);
    }
  });

  it("rejects a replace or add with no Evidence", () => {
    expect(reasonFor(change({ op: "replace", targetItemId: "exp1.b1", before: "a", after: "b", evidenceIds: [] }))).toBe(STAGE1_REASONS.noEvidence);
    expect(reasonFor(change({ op: "add", parentId: "skills", after: "Go", evidenceIds: [] }))).toBe(STAGE1_REASONS.noEvidence);
  });

  it("rejects unknown Evidence, section-ID Evidence and an added Item as Evidence", () => {
    const base = { op: "replace", targetItemId: "exp1.b1", before: "", after: "" } as const;
    expect(reasonFor(change({ ...base, evidenceIds: ["zzz"] }))).toBe(STAGE1_REASONS.unknownEvidence);
    expect(reasonFor(change({ ...base, evidenceIds: ["skills"] }))).toBe(STAGE1_REASONS.sectionEvidence);
    expect(reasonFor(change({ ...base, evidenceIds: ["sec1"] }))).toBe(STAGE1_REASONS.sectionEvidence);

    const original = testCv();
    const draft = applyChanges(original, [change({ op: "add", parentId: "skills", after: "Redis" })]);
    const result = stage1Checks(original, draft, [change({ ...base, evidenceIds: ["skill4"] })]);
    expect(result.rejected[0]!.reason).toBe(STAGE1_REASONS.addedItemEvidence);
  });

  it("accepts a CV entry (a job) as Evidence", () => {
    const result = check(change({ op: "add", parentId: "skills", after: "Express", evidenceIds: ["exp1"] }));
    expect(result.passed).toHaveLength(1);
  });

  it("add: parent must exist and accept text Items", () => {
    const e = ["exp1.b1"];
    expect(reasonFor(change({ op: "add", parentId: "exp9", after: "x", evidenceIds: e }))).toBe(STAGE1_REASONS.unknownParent);
    expect(reasonFor(change({ op: "add", parentId: "experience", after: "x", evidenceIds: e }))).toBe(STAGE1_REASONS.parentNotText);
    expect(reasonFor(change({ op: "add", parentId: "certifications", after: "x", evidenceIds: e }))).toBe(STAGE1_REASONS.parentNotText);
    expect(check(change({ op: "add", parentId: "sec1", after: "Ran a coding club", evidenceIds: ["sec1.i2"] })).passed).toHaveLength(1);
  });

  it("reorder must be a permutation of the same Items", () => {
    const p = { op: "reorder", parentId: "skills" } as const;
    expect(check(change({ ...p, orderedItemIds: ["skill3", "skill1", "skill2"] })).passed).toHaveLength(1);
    for (const ids of [["skill1", "skill2"], ["skill1", "skill2", "skill3", "skill4"], ["skill1", "skill1", "skill2"], ["skill1", "skill2", "exp1"]]) {
      expect(reasonFor(change({ ...p, orderedItemIds: ids }))).toBe(STAGE1_REASONS.notPermutation);
    }
    expect(reasonFor(change({ op: "reorder", parentId: "exp9", orderedItemIds: [] }))).toBe(STAGE1_REASONS.unknownParent);
  });

  it("reorder is checked against the draft, so an added Item must be listed", () => {
    const original = testCv();
    const draft = applyChanges(original, [change({ op: "add", parentId: "skills", after: "Redis" })]);
    const old = change({ op: "reorder", parentId: "skills", orderedItemIds: ["skill3", "skill1", "skill2"] });
    const fresh = change({ op: "reorder", parentId: "skills", orderedItemIds: ["skill4", "skill3", "skill1", "skill2"] });
    const result = stage1Checks(original, draft, [old, fresh]);
    expect(result.passed).toEqual([fresh]);
  });
});

describe("stage1Checks frozen numbers", () => {
  const text = "Cut build time by 40% for 3 services";
  const rep = (after: string, evidenceIds = ["exp1.b2"]) =>
    change({ op: "replace", targetItemId: "exp1.b2", before: text, after, evidenceIds });

  it("passes when every number survives and none is new", () => {
    expect(check(rep("Reduced build time by 40% across 3 services")).passed).toHaveLength(1);
  });

  it("rejects a dropped number", () => {
    expect(reasonFor(rep("Cut build time by 40% for several services"))).toBe(STAGE1_REASONS.numberDropped);
    expect(reasonFor(rep("Cut build time by 40 for 3 services"))).toBe(STAGE1_REASONS.numberDropped);
  });

  it("rejects a new number not in the before text or the Evidence", () => {
    expect(reasonFor(rep("Cut build time by 40% for 3 services in 2023"))).toBe(STAGE1_REASONS.numberAdded);
  });

  it("allows a new number that the cited Evidence holds", () => {
    const result = check(rep("Cut build time by 40% for 3 services since 2020-01", ["exp1.b2", "exp1"]));
    expect(result.passed).toHaveLength(1);
  });

  it("rejects 3 services -> three services", () => {
    expect(reasonFor(rep("Cut build time by 40% for three services"))).toBe(STAGE1_REASONS.numberDropped);
  });

  it("handles decimals and plus signs as part of the number", () => {
    const cv = testCv();
    const c = change({ op: "replace", targetItemId: "exp1.b1", before: "Handled 1.5M requests, 10+ teams", after: "Handled 1.5M requests, 10 teams", evidenceIds: ["exp1.b1"] });
    expect(stage1Checks(cv, cv, [c]).rejected[0]!.reason).toBe(STAGE1_REASONS.numberDropped);
  });

  it("rejects a new number on an add unless Evidence holds it", () => {
    expect(reasonFor(change({ op: "add", parentId: "exp1", after: "Served 500 users", evidenceIds: ["exp1.b1"] }))).toBe(STAGE1_REASONS.numberAdded);
    expect(check(change({ op: "add", parentId: "exp1", after: "Reduced build time by 40%", evidenceIds: ["exp1.b2"] })).passed).toHaveLength(1);
  });

  it("protects a date in an additional-section Item", () => {
    const c = change({ op: "replace", targetItemId: "sec1.i1", before: "Mentored 4 students in 2021", after: "Mentored 4 students", evidenceIds: ["sec1.i1"] });
    const cv = testCv();
    expect(stage1Checks(cv, cv, [c]).rejected[0]!.reason).toBe(STAGE1_REASONS.numberDropped);
    const moved = change({ op: "replace", targetItemId: "sec1.i1", before: "Mentored 4 students in 2021", after: "Mentored 4 students in 2022", evidenceIds: ["sec1.i1"] });
    expect(stage1Checks(cv, cv, [moved]).rejected[0]!.reason).toBe(STAGE1_REASONS.numberDropped);
  });

  it("does not check numbers on a reorder", () => {
    expect(check(change({ op: "reorder", parentId: "skills", orderedItemIds: ["skill2", "skill1", "skill3"] })).passed).toHaveLength(1);
  });
});

describe("stage1Checks with User Evidence", () => {
  const userEvidence = [{ id: "ue1", questionId: "q1", requirementId: "req1", text: "Ran 12 clusters at Acme." }] as never;
  const cv = testCv();
  const run = (c: ReturnType<typeof change>) => stage1Checks(cv, cv, [c], userEvidence);

  it("accepts a known ue ID as Evidence, alone or beside a CV Item", () => {
    const add = change({ op: "add", parentId: "exp1", after: "Ran clusters at Acme", evidenceIds: ["ue1"] });
    const mixed = change({ op: "add", parentId: "exp1", after: "Ran clusters", evidenceIds: ["exp1.b1", "ue1"] });
    expect(run(add).passed).toEqual([add]);
    expect(run(mixed).passed).toEqual([mixed]);
  });

  it("rejects an unknown ue ID", () => {
    const c = change({ op: "add", parentId: "exp1", after: "Ran clusters", evidenceIds: ["ue9"] });
    expect(run(c).rejected).toEqual([{ change: c, reason: STAGE1_REASONS.unknownEvidence }]);
    expect(stage1Checks(cv, cv, [c]).rejected).toHaveLength(1);
  });

  it("lets a number from cited User Evidence appear in after, and not one from uncited text", () => {
    const cited = change({ op: "add", parentId: "exp1", after: "Ran 12 clusters", evidenceIds: ["ue1"] });
    const other = change({ op: "add", parentId: "exp1", after: "Ran 13 clusters", evidenceIds: ["ue1"] });
    expect(run(cited).passed).toEqual([cited]);
    expect(run(other).rejected[0]!.reason).toBe(STAGE1_REASONS.numberAdded);
  });
});

describe("stage1Checks item tags", () => {
  it("rejects a replace whose text starts with the summary tag", () => {
    const c = change({ op: "replace", targetItemId: "summary", before: "", after: "[summary] Backend developer", evidenceIds: ["exp1.b1"] });
    expect(reasonFor(c)).toBe(STAGE1_REASONS.itemTag);
  });

  it("rejects an add whose text holds an Item tag mid-text", () => {
    const c = change({ op: "add", parentId: "exp1", after: "Built the API [exp1.b2] for orders", evidenceIds: ["exp1.b1"] });
    expect(reasonFor(c)).toBe(STAGE1_REASONS.itemTag);
  });

  it("passes ordinary brackets that are not ID-shaped", () => {
    const c = change({ op: "add", parentId: "exp1", after: "Built a CLI [open source] and a [beta] tool", evidenceIds: ["exp1.b1"] });
    const result = check(c);
    expect(result.rejected).toEqual([]);
    expect(result.passed).toEqual([c]);
  });
});
