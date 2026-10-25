import { describe, expect, it } from "vitest";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { change, testCv } from "./testCv.js";

describe("applyChanges", () => {
  it("returns an equal CV when there are no Changes", () => {
    const cv = testCv();
    expect(applyChanges(cv, [])).toEqual(cv);
  });

  it("replace sets a text Item's text", () => {
    const draft = applyChanges(testCv(), [
      change({ op: "replace", targetItemId: "exp1.b1", before: "x", after: "New wording" }),
    ]);
    expect(draft.experience[0]!.bullets[0]).toEqual({ id: "exp1.b1", text: "New wording" });
    expect(draft.experience[0]!.bullets[1]!.text).toBe("Cut build time by 40% for 3 services");
  });

  it("replace works on the summary, a skill and an additional-section item", () => {
    const draft = applyChanges(testCv(), [
      change({ op: "replace", targetItemId: "summary", before: "x", after: "S" }),
      change({ op: "replace", targetItemId: "skill2", before: "x", after: "Postgres" }),
      change({ op: "replace", targetItemId: "sec1.i2", before: "x", after: "Ran a club" }),
    ]);
    expect(draft.summary!.text).toBe("S");
    expect(draft.skills[1]!.text).toBe("Postgres");
    expect(draft.additionalSections[0]!.items[1]!.text).toBe("Ran a club");
  });

  it("add continues the parent's numbering", () => {
    const draft = applyChanges(testCv(), [
      change({ op: "add", parentId: "exp1", after: "A" }),
      change({ op: "add", parentId: "skills", after: "Redis" }),
      change({ op: "add", parentId: "sec1", after: "Wrote a blog" }),
      change({ op: "add", parentId: "proj1", after: "P" }),
      change({ op: "add", parentId: "edu1", after: "E" }),
    ]);
    expect(draft.experience[0]!.bullets.at(-1)).toEqual({ id: "exp1.b3", text: "A" });
    expect(draft.skills.at(-1)).toEqual({ id: "skill4", text: "Redis" });
    expect(draft.additionalSections[0]!.items.at(-1)).toEqual({ id: "sec1.i3", text: "Wrote a blog" });
    expect(draft.projects[0]!.bullets.at(-1)!.id).toBe("proj1.b2");
    expect(draft.education[0]!.bullets.at(-1)!.id).toBe("edu1.b2");
  });

  it("several adds to one parent get consecutive IDs in array order", () => {
    const changes = [
      change({ op: "add", parentId: "skills", after: "A" }),
      change({ op: "add", parentId: "skills", after: "B" }),
    ];
    const draft = applyChanges(testCv(), changes);
    expect(draft.skills.slice(3)).toEqual([
      { id: "skill4", text: "A" },
      { id: "skill5", text: "B" },
    ]);
    expect(applyChanges(testCv(), changes)).toEqual(draft); // stable
  });

  it("numbers after the highest existing number, even with a gap", () => {
    const cv = testCv();
    cv.skills.splice(1, 1); // skill1, skill3
    const draft = applyChanges(cv, [change({ op: "add", parentId: "skills", after: "Go" })]);
    expect(draft.skills.at(-1)!.id).toBe("skill4");
  });

  it("a new ID never equals an existing or reserved ID", () => {
    const cv = testCv();
    const draft = applyChanges(cv, [
      change({ op: "add", parentId: "skills", after: "A" }),
      change({ op: "add", parentId: "exp2", after: "B" }),
    ]);
    const ids = [...draft.skills, ...draft.experience.flatMap((e) => e.bullets)].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reserved of ["experience", "education", "skills", "projects", "certifications"]) {
      expect(ids).not.toContain(reserved);
    }
  });

  it("reorder reorders a bullet list, a skills list and a section list", () => {
    const draft = applyChanges(testCv(), [
      change({ op: "reorder", parentId: "exp1", orderedItemIds: ["exp1.b2", "exp1.b1"] }),
      change({ op: "reorder", parentId: "skills", orderedItemIds: ["skill3", "skill1", "skill2"] }),
      change({ op: "reorder", parentId: "experience", orderedItemIds: ["exp2", "exp1"] }),
    ]);
    expect(draft.experience.map((e) => e.id)).toEqual(["exp2", "exp1"]);
    expect(draft.experience[1]!.bullets.map((b) => b.id)).toEqual(["exp1.b2", "exp1.b1"]);
    expect(draft.skills.map((s) => s.id)).toEqual(["skill3", "skill1", "skill2"]);
  });

  it("applies add, replace and reorder together, a reorder may list an added Item", () => {
    const draft = applyChanges(testCv(), [
      change({ op: "reorder", parentId: "skills", orderedItemIds: ["skill4", "skill1", "skill2", "skill3"] }),
      change({ op: "replace", targetItemId: "skill4", before: "", after: "Redis, cached" }),
      change({ op: "add", parentId: "skills", after: "Redis" }),
    ]);
    expect(draft.skills.map((s) => s.id)).toEqual(["skill4", "skill1", "skill2", "skill3"]);
    expect(draft.skills[0]!.text).toBe("Redis, cached");
  });

  it("does not mutate its input", () => {
    const cv = testCv();
    const snapshot = structuredClone(cv);
    applyChanges(cv, [
      change({ op: "replace", targetItemId: "summary", before: "x", after: "S" }),
      change({ op: "add", parentId: "skills", after: "Redis" }),
      change({ op: "reorder", parentId: "skills", orderedItemIds: ["skill3", "skill2", "skill1"] }),
    ]);
    expect(cv).toEqual(snapshot);
  });

  it("leaves dates, companies, titles and degrees unchanged", () => {
    const cv = testCv();
    const draft = applyChanges(cv, [
      change({ op: "replace", targetItemId: "exp1.b1", before: "x", after: "Y" }),
      change({ op: "add", parentId: "exp1", after: "Z" }),
      change({ op: "reorder", parentId: "experience", orderedItemIds: ["exp2", "exp1"] }),
    ]);
    const strip = (c: typeof cv) => ({
      experience: c.experience.map(({ id, company, title, dates }) => ({ id, company, title, dates })),
      education: c.education,
      contact: c.contact,
      certifications: c.certifications,
    });
    expect(strip(draft).experience.find((e) => e.id === "exp1")).toEqual(strip(cv).experience[0]);
    expect(strip(draft).education).toEqual(strip(cv).education);
    expect(strip(draft).certifications).toEqual(strip(cv).certifications);
  });

  it("throws when a Change does not fit the CV", () => {
    expect(() => applyChanges(testCv(), [change({ op: "replace", targetItemId: "exp1", before: "", after: "x" })])).toThrow();
    expect(() => applyChanges(testCv(), [change({ op: "add", parentId: "experience", after: "x" })])).toThrow();
  });
});
