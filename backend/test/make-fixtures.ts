// Generates the synthetic CV fixtures used by the parser tests and the Postman collection.
// Everything here is fictional; no real CV is ever committed. Run with `pnpm --filter backend fixtures`.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const LINES = [
  "Jane Doe",
  "jane.doe@example.com | +1 555 0100 | Springfield",
  "SUMMARY",
  "Backend developer with six years of experience building REST APIs and data pipelines.",
  "EXPERIENCE",
  "Senior Backend Developer, Acme Corp (2021 - Present)",
  "- Designed and maintained Node.js services backed by PostgreSQL.",
  "- Reduced p95 API latency by 40% through query tuning and caching.",
  "Backend Developer, Initech (2018 - 2021)",
  "- Built internal tooling in TypeScript and automated the release process.",
  "EDUCATION",
  "BSc Computer Science, Springfield University (2014 - 2018)",
  "SKILLS",
  "TypeScript, Node.js, PostgreSQL, Docker, AWS",
];

async function textPdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = pdf.addPage([595, 842]);
    LINES.forEach((line, i) => page.drawText(line, { x: 50, y: 790 - i * 22, size: 12, font }));
  }
  return pdf.save();
}

/** Pages with only drawn shapes and no text, like a scan: extraction yields nothing. */
async function scannedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let p = 0; p < 2; p++) {
    const page = pdf.addPage([595, 842]);
    for (let i = 0; i < 30; i++) page.drawRectangle({ x: 50, y: 790 - i * 24, width: 300 + (i % 5) * 40, height: 8, color: rgb(0.1, 0.1, 0.1) });
  }
  return pdf.save();
}

async function docx(): Promise<Buffer> {
  const [name, ...rest] = LINES;
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: name!, heading: HeadingLevel.TITLE }),
          ...rest.map((l) => new Paragraph({ text: l })),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

const write = (name: string, data: Uint8Array | Buffer | string) => writeFileSync(join(dir, name), data);

write("cv.pdf", await textPdf(1));
write("cv.docx", await docx());
write("cv-six-pages.pdf", await textPdf(6));
write("cv-scanned.pdf", await scannedPdf());
// A valid one-page PDF padded past the 5 MB limit with trailing bytes.
write("cv-oversized.pdf", Buffer.concat([Buffer.from(await textPdf(1)), Buffer.alloc(6 * 1024 * 1024, 0x20)]));
write("cv-corrupt.pdf", Buffer.from("%PDF-1.7\nthis is not a real pdf body\n"));
write("not-a-cv.txt", "Just a plain text file.\n");
console.log(`Wrote fixtures to ${dir}`);
