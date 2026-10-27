import { describe, expect, it } from "vitest";
import { formatDateRange, layoutCv } from "@/export/layout.js";
import type { Block } from "@/export/layout.js";
import { fixtureCv } from "./exportCv.js";

const headings = (blocks: Block[]) => blocks.flatMap((b) => (b.kind === "heading" ? [b.text] : []));

describe("layoutCv", () => {
  it("puts the sections in the fixed order, uppercase", () => {
    expect(headings(layoutCv(fixtureCv()))).toEqual([
      "PROFESSIONAL SUMMARY",
      "PROFESSIONAL EXPERIENCE",
      "PROJECTS",
      "EDUCATION",
      "TECHNICAL SKILLS",
      "CERTIFICATIONS",
      "VOLUNTEERING",
    ]);
  });

  it("starts with the name and the Headline, then labelled contact lines and links", () => {
    const blocks = layoutCv(fixtureCv());
    expect(blocks.slice(0, 8)).toEqual([
      { kind: "name", text: "Nora Quill" },
      { kind: "headline", text: "Backend software engineer" },
      { kind: "contact", label: "Phone", value: "+1 555 0100" },
      { kind: "contact", label: "Email", value: "nora@example.com" },
      { kind: "contact", label: "Location", value: "Springfield" },
      { kind: "contact", label: "GitHub", value: "https://github.com/nora-quill" },
      { kind: "contact", label: null, value: "https://nora.example.com/portfolio-site" },
      { kind: "heading", text: "PROFESSIONAL SUMMARY" },
    ]);
  });

  it("skips empty contact fields and the Headline when absent", () => {
    const cv = fixtureCv();
    const blocks = layoutCv({ ...cv, contact: { ...cv.contact, headline: null, phone: null, location: "", links: [] } });
    expect(blocks.filter((b) => b.kind === "headline" || b.kind === "contact")).toEqual([{ kind: "contact", label: "Email", value: "nora@example.com" }]);
  });

  it("leaves out empty sections", () => {
    const cv = fixtureCv();
    const blocks = layoutCv({ ...cv, summary: null, projects: [], certifications: [], additionalSections: [{ id: cv.additionalSections[0]!.id, title: "Awards", items: [] }] });
    expect(headings(blocks)).toEqual(["PROFESSIONAL EXPERIENCE", "EDUCATION", "TECHNICAL SKILLS"]);
  });

  it("formats experience entries with the Title — Company, location and dates", () => {
    const entries = layoutCv(fixtureCv()).flatMap((b) => (b.kind === "entry" ? [b] : []));
    expect(entries[0]).toEqual({
      kind: "entry",
      left: [{ text: "Senior Developer — Fernwood Labs", bold: true }, { text: ", Remote" }],
      right: "2024 – Present",
    });
    expect(entries[1]!.right).toBe("Jun 2017 – Feb 2020");
    expect(entries.find((e) => e.left[0]!.text === "Notes app")!.right).toBe("https://notes.example.com");
    expect(entries.at(-1)).toMatchObject({ left: [{ text: "Cloud Basics — Example Academy" }], right: "May 2021" });
  });
});

describe("formatDateRange", () => {
  it("covers each shape", () => {
    expect(formatDateRange({ start: "2012", end: "2016", current: false })).toBe("2012 – 2016");
    expect(formatDateRange({ start: null, end: "2016-04", current: false })).toBe("Apr 2016");
    expect(formatDateRange({ start: "2020-01", end: null, current: false })).toBe("Jan 2020");
    expect(formatDateRange({ start: null, end: null, current: false })).toBeNull();
  });
});
