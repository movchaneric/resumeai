import mammoth from "mammoth";
import { inflateRawSync } from "node:zlib";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";
import { renderDocx } from "@/export/docxRenderer.js";
import { layoutCv } from "@/export/layout.js";
import { measureFit } from "@/export/measureFit.js";
import { renderPdf } from "@/export/pdfRenderer.js";
import { docxSizes, FLOOR_STEP, sizesForStep } from "@/export/sizes.js";
import { fixtureCv, longCv } from "./exportCv.js";

/** Entry names and bytes of a zip, read from its central directory (enough for the stored/deflated parts docx writes). */
function unzip(buffer: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
    const dataAt = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(dataAt, dataAt + size);
    files.set(name, method === 8 ? inflateRawSync(raw) : raw);
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const docxText = async (buffer: Buffer): Promise<string> => (await mammoth.extractRawText({ buffer })).value;

describe("renderDocx", () => {
  it("shows the fixture CV's text in the same order as the PDF", async () => {
    const blocks = layoutCv(fixtureCv());
    const fit = await measureFit(fixtureCv());
    if (!fit.fits) throw new Error("fixture should fit");
    expect(fit.blocks).toEqual(blocks);
    const pdf = await getDocumentProxy(new Uint8Array((await renderPdf(blocks, fit.sizes)).buffer));
    const pdfText = (await extractText(pdf, { mergePages: true })).text;
    const docx = await docxText(await renderDocx(blocks, docxSizes(fit.step)));

    const keys = [
      "Nora Quill",
      "Backend software engineer",
      "Phone: +1 555 0100",
      "PROFESSIONAL SUMMARY",
      "PROFESSIONAL EXPERIENCE",
      "Senior Developer — Fernwood Labs",
      "2024 – Present",
      "Built the orders service in Express and PostgreSQL.",
      "Jun 2017 – Feb 2020",
      "PROJECTS",
      "Notes app",
      "Mar 2022 – Sep 2022",
      "EDUCATION",
      "TECHNICAL SKILLS",
      "CERTIFICATIONS",
      "VOLUNTEERING",
      "Ran a coding club",
    ];
    for (const text of [pdfText, docx]) {
      const positions = keys.map((key) => text.indexOf(key));
      expect(positions.every((p) => p >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    }
    expect(docx).toContain("https://github.com/nora-quill");
  });

  it("is a valid DOCX on A4 with the margins from the size table and the bundled fonts embedded", async () => {
    const sizes = sizesForStep(2);
    const buffer = await renderDocx(layoutCv(fixtureCv()), sizes);
    expect(await docxText(buffer)).toContain("Nora Quill");

    const files = unzip(buffer);
    const embedded = [...files.keys()].filter((name) => name.startsWith("word/fonts/"));
    expect(embedded.filter((name) => name.endsWith(".odttf")).length).toBeGreaterThanOrEqual(5);
    const table = files.get("word/fontTable.xml")!.toString();
    for (const family of ["Figtree", "Poppins", "Poppins SemiBold"]) expect(table).toContain(`w:name="${family}"`);

    const document = files.get("word/document.xml")!.toString();
    expect(document).toContain('w:w="11906"');
    expect(document).toContain('w:h="16838"');
    expect(document).toContain(`w:left="${Math.round(sizes.margin * 20)}"`);
    expect(document).toContain('w:val="right"'); // the date tab stop
    expect(document).toContain('w:fill="e4e4e7"'); // the heading bar
  });

  it("never sets a font larger than its size step, rounding quarter-points down to the half-point", async () => {
    for (let step = 0; step <= FLOOR_STEP; step++) {
      const sizes = sizesForStep(step);
      const files = unzip(await renderDocx(layoutCv(fixtureCv()), sizes));
      const allowed = new Set([sizes.body, sizes.name, sizes.headline, sizes.heading].map((pt) => Math.floor(pt * 2 + 1e-9)));
      for (const part of ["word/document.xml", "word/numbering.xml"]) {
        const values = [...files.get(part)!.toString().matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => Number(m[1]));
        expect(values.length).toBeGreaterThan(0);
        for (const value of values) {
          expect(allowed.has(value), `step ${step} ${part} sz ${value}`).toBe(true);
          expect(value).toBeLessThanOrEqual(Math.floor(sizes.name * 2 + 1e-9));
        }
      }
      expect(files.get("word/document.xml")!.toString()).toContain(`<w:sz w:val="${Math.floor(sizes.body * 2 + 1e-9)}"/>`);
    }
    const step1 = unzip(await renderDocx(layoutCv(fixtureCv()), sizesForStep(1)));
    expect(step1.get("word/document.xml")!.toString()).toContain('<w:sz w:val="20"/>');
  });

  it("is not written to disk: it returns a Buffer", async () => {
    expect(Buffer.isBuffer(await renderDocx(layoutCv(longCv(1, 2)), sizesForStep(0)))).toBe(true);
  });
});

describe("docxSizes", () => {
  it("is one step smaller than the PDF's, and the same at the floor", () => {
    expect(docxSizes(0).step).toBe(1);
    expect(docxSizes(3).step).toBe(4);
    expect(docxSizes(3).body).toBeLessThan(sizesForStep(3).body);
    expect(docxSizes(FLOOR_STEP - 1).step).toBe(FLOOR_STEP);
    expect(docxSizes(FLOOR_STEP)).toEqual(sizesForStep(FLOOR_STEP));
  });
});
