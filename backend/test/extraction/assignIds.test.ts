import { describe, expect, it } from "vitest";
import { SectionIdSchema } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";
import { fullCv } from "./cvFixture.js";
import { ExtractionError } from "@/extraction/errors.js";

function ids(cv: ReturnType<typeof assignCvIds>): string[] {
  return [
    cv.contact.id,
    ...(cv.summary ? [cv.summary.id] : []),
    ...cv.experience.flatMap((e) => [e.id, ...e.bullets.map((b) => b.id)]),
    ...cv.education.flatMap((e) => [e.id, ...e.bullets.map((b) => b.id)]),
    ...cv.skills.map((s) => s.id),
    ...cv.projects.flatMap((p) => [p.id, ...p.bullets.map((b) => b.id)]),
    ...cv.certifications.map((c) => c.id),
    ...cv.additionalSections.flatMap((s) => [s.id, ...s.items.map((i) => i.id)]),
  ];
}

describe("assignCvIds", () => {
  it("assigns the full ID scheme in order", () => {
    const cv = assignCvIds(fullCv());
    expect(ids(cv)).toEqual([
      "contact",
      "summary",
      "exp1", "exp1.b1", "exp1.b2",
      "exp2", "exp2.b1",
      "edu1", "edu1.b1",
      "skill1", "skill2",
      "proj1", "proj1.b1",
      "cert1",
      "sec1", "sec1.i1", "sec1.i2",
    ]);
  });

  it("uses unique IDs, none equal to a reserved SectionId", () => {
    const all = ids(assignCvIds(fullCv()));
    expect(new Set(all).size).toBe(all.length);
    for (const id of all) expect(SectionIdSchema.safeParse(id).success).toBe(false);
  });

  it("takes the prefix from the section type, not the heading", () => {
    const cv = assignCvIds(fullCv());
    expect(cv.additionalSections[0]?.id).toBe("sec1");
  });

  it("keeps summary null when there is none", () => {
    expect(assignCvIds({ ...fullCv(), summary: null }).summary).toBeNull();
  });

  it("fails with a readable issue when a range ends before it starts", () => {
    const bad = fullCv();
    bad.experience[1]!.dates = { start: "2022", end: "2020", current: false };
    try {
      assignCvIds(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ExtractionError);
      expect((e as ExtractionError).issues).toContain("experience[1].dates: End date is before start date");
    }
  });
});
