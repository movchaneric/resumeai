import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { layoutCv } from "@/export/layout.js";
import { measureFit } from "@/export/measureFit.js";
import { renderPdf } from "@/export/pdfRenderer.js";
import { FLOOR_STEP, sizesForStep } from "@/export/sizes.js";
import { fixtureCv, fixtureExtracted, longCv } from "./exportCv.js";
import { assignCvIds } from "@/extraction/assignIds.js";

async function readPdf(buffer: Buffer): Promise<{ pages: number; text: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  return { pages: totalPages, text };
}

describe("size table", () => {
  it("steps the body 0.25pt from 10.5 to 9 and the margins from 1.8 to 1.2 cm", () => {
    expect(FLOOR_STEP).toBe(6);
    expect(sizesForStep(0).body).toBe(10.5);
    expect(sizesForStep(0).margin).toBeCloseTo(51.02, 1);
    expect(sizesForStep(1).body).toBe(10.25);
    expect(sizesForStep(6).body).toBe(9);
    expect(sizesForStep(6).margin).toBeCloseTo(34.02, 1);
    expect(sizesForStep(6).name).toBeLessThan(sizesForStep(0).name);
  });
});

describe("renderPdf", () => {
  it("renders the fixture CV on one page with the sections in order, the Headline under the name and the agreed dates", async () => {
    const fit = await measureFit(fixtureCv());
    expect(fit).toMatchObject({ fits: true, step: 0 });
    const { buffer, pages } = await renderPdf(layoutCv(fixtureCv()), sizesForStep(0));
    const read = await readPdf(buffer);
    expect(pages).toBe(1);
    expect(read.pages).toBe(1);

    const order = ["Nora Quill", "Backend software engineer", "PROFESSIONAL SUMMARY", "PROFESSIONAL EXPERIENCE", "PROJECTS", "EDUCATION", "TECHNICAL SKILLS", "CERTIFICATIONS", "VOLUNTEERING"];
    const positions = order.map((s) => read.text.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(read.text).toContain("Jun 2017 – Feb 2020");
    expect(read.text).toContain("2024 – Present");
    expect(read.text).toContain("Senior Developer — Fernwood Labs");
    expect(read.text).toContain("https://github.com/nora-quill");
  });

  it("emits no heading for an empty section", async () => {
    const cv = assignCvIds({ ...fixtureExtracted, projects: [], certifications: [], additionalSections: [] });
    const { buffer } = await renderPdf(layoutCv(cv), sizesForStep(0));
    const { text } = await readPdf(buffer);
    for (const heading of ["PROJECTS", "CERTIFICATIONS", "VOLUNTEERING"]) expect(text).not.toContain(heading);
    expect(text).toContain("EDUCATION");
  });
});

describe("measureFit", () => {
  it("shrinks a long CV until it fits one page", async () => {
    const cv = longCv(2, 6);
    const normal = await renderPdf(layoutCv(cv), sizesForStep(0));
    expect(normal.pages).toBeGreaterThan(1);
    const fit = await measureFit(cv);
    expect(fit.fits).toBe(true);
    if (!fit.fits) return;
    expect(fit.step).toBeGreaterThan(0);
    expect(fit.sizes.body).toBeLessThan(10.5);
    const { buffer } = await renderPdf(layoutCv(cv), fit.sizes);
    expect((await readPdf(buffer)).pages).toBe(1);
    // It is the first step that fits.
    expect((await renderPdf(layoutCv(cv), sizesForStep(fit.step - 1))).pages).toBeGreaterThan(1);
  });

  it("reports a CV that is too long even at the floor, with how far over", async () => {
    const fit = await measureFit(longCv(4, 6));
    expect(fit.fits).toBe(false);
    if (fit.fits) return;
    expect(fit.overBy).toBeGreaterThan(0);
  });
});
