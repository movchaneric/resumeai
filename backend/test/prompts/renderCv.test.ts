import { describe, expect, it } from "vitest";
import { RequirementSchema } from "@resume-ai/shared";
import type { Cv, Requirement } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";
import { renderCv, renderRequirements } from "@/prompts/renderCv.js";
import { fullCv } from "../extraction/cvFixture.js";

const cv = (): Cv => assignCvIds(fullCv());

describe("renderCv", () => {
  it("renders every section type with its IDs", () => {
    const text = renderCv(cv());
    for (const id of [
      "[contact]",
      "[summary]",
      "[exp1]",
      "[exp2]",
      "[edu1]",
      "[skill1]",
      "[skill2]",
      "[proj1]",
      "[cert1]",
      "[sec1.i1]",
      "[sec1.i2]",
    ]) {
      expect(text).toContain(id);
    }
    for (const heading of ["## Contact", "## Summary", "## Experience", "## Education", "## Skills", "## Projects", "## Certifications"]) {
      expect(text).toContain(heading);
    }
  });

  it("puts sections in a fixed order", () => {
    const text = renderCv(cv());
    const order = ["## Contact", "## Summary", "## Experience", "## Education", "## Skills", "## Projects", "## Certifications"];
    const positions = order.map((h) => text.indexOf(h));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it("indents bullets under their parent", () => {
    const lines = renderCv(cv()).split("\n");
    const job = lines.findIndex((l) => l.startsWith("[exp1]"));
    expect(lines[job]).toContain("Dev");
    expect(lines[job]).toContain("Acme");
    expect(lines[job + 1]).toBe("  [exp1.b1] Built a");
    expect(lines[job + 2]).toBe("  [exp1.b2] Built b");
  });

  it("uses the candidate's own title for an additional section", () => {
    const text = renderCv(cv());
    expect(text).toContain("## Experience\n[sec1.i1] Volunteer a\n[sec1.i2] Volunteer b");
  });

  it("leaves out empty sections", () => {
    const extracted = fullCv();
    extracted.summary = null;
    extracted.education = [];
    extracted.projects = [];
    extracted.certifications = [];
    extracted.additionalSections = [];
    const text = renderCv(assignCvIds(extracted));
    expect(text).not.toContain("## Summary");
    expect(text).not.toContain("## Education");
    expect(text).not.toContain("## Projects");
    expect(text).not.toContain("## Certifications");
    expect(text).toContain("## Experience");
  });

  it("writes dates as YYYY-MM – present and YYYY – YYYY", () => {
    const extracted = fullCv();
    extracted.experience[0]!.dates = { start: "2021-03", end: null, current: true };
    extracted.experience[1]!.dates = { start: "2018", end: "2020-06", current: false };
    const text = renderCv(assignCvIds(extracted));
    expect(text).toContain("2021-03 – present");
    expect(text).toContain("2018 – 2020-06");
  });

  it("has one blank line between sections and none inside one", () => {
    const text = renderCv(cv());
    expect(text).not.toMatch(/\n\n\n/);
    for (const section of text.split("\n\n")) {
      expect(section.startsWith("## ")).toBe(true);
    }
  });
});

describe("renderRequirements", () => {
  it("renders one line per Requirement with its ID and importance", () => {
    const requirements: Requirement[] = [
      RequirementSchema.parse({ id: "req1", text: "Node.js, 5+ years", source: "s", kind: "skill", importance: "must_have" }),
      RequirementSchema.parse({ id: "req2", text: "Docker", source: "s", kind: "skill", importance: "nice_to_have" }),
    ];
    expect(renderRequirements(requirements)).toBe("[req1] (must-have) Node.js, 5+ years\n[req2] (nice-to-have) Docker");
  });
});
