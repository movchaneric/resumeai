// Generates the synthetic CV fixtures used by the parser tests and the Postman collection.
// Everything here is fictional; no real CV is ever committed. Run with `pnpm --filter backend fixtures`.
import { createHash } from "node:crypto";
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

/** A two-column CV: sidebar on the left, main column on the right, dates at the right edge of each title line. */
async function twoColumnPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595, 842]);
  const text = (t: string, x: number, y: number, size = 10, f = font) => page.drawText(t, { x, y, size, font: f });

  // Deliberately drawn out of visual order: the main column first, each job's date after all the titles, the sidebar last.
  const MAIN_X = 230;
  const DATE_X = 480;
  text("SUMMARY", MAIN_X, 780, 11, bold);
  text("Backend developer with six years of experience building", MAIN_X, 764);
  text("REST APIs and data pipelines.", MAIN_X, 751);
  text("EXPERIENCE", MAIN_X, 722, 11, bold);
  text("Senior Backend Developer, Acme Corp", MAIN_X, 704, 10, bold);
  text("- Designed and maintained Node.js services on PostgreSQL.", MAIN_X, 689);
  text("- Reduced p95 API latency by 40% through query tuning.", MAIN_X, 676);
  text("Backend Developer, Initech", MAIN_X, 652, 10, bold);
  text("- Built internal tooling in TypeScript and automated releases.", MAIN_X, 637);
  text("EDUCATION", MAIN_X, 608, 11, bold);
  text("BSc Computer Science, Springfield University", MAIN_X, 590, 10, bold);
  text("2021 - Present", DATE_X, 704);
  text("2018 - 2021", DATE_X, 652);
  text("2014 - 2018", DATE_X, 590);

  text("Jane Doe", 40, 780, 18, bold);
  text("Backend Developer", 40, 760, 11);
  text("CONTACT", 40, 722, 11, bold);
  text("jane.doe@example.com", 40, 704);
  text("+1 555 0100", 40, 690);
  text("Springfield, Example State", 40, 676);
  text("SKILLS", 40, 640, 11, bold);
  text("TypeScript, Node.js, PostgreSQL", 40, 622);
  text("Docker, AWS, REST API design", 40, 608);
  return pdf.save();
}

// ---- Encrypted PDF -------------------------------------------------------------------------------------------
// pdf-lib cannot encrypt, so this writes a minimal one-page PDF by hand using the PDF standard security handler
// (revision 2, 40-bit RC4, ISO 32000-1 section 7.6). The user password is non-empty, so opening it needs a password.
const PAD = Buffer.from("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A", "hex");
const md5 = (...parts: Buffer[]) => createHash("md5").update(Buffer.concat(parts)).digest();

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + s[i]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

function encryptedPdf(): Buffer {
  const pad = (pw: string) => Buffer.concat([Buffer.from(pw, "latin1"), PAD]).subarray(0, 32);
  const id = md5(Buffer.from("resume-ai fixture"));
  const permissions = Buffer.alloc(4);
  permissions.writeInt32LE(-4);
  const ownerKey = md5(pad("owner-secret")).subarray(0, 5);
  const o = rc4(ownerKey, pad("user-secret"));
  const key = md5(pad("user-secret"), o, permissions, id).subarray(0, 5);
  const u = rc4(key, PAD);

  const content = Buffer.from("BT /F1 12 Tf 50 780 Td (Jane Doe, a fictional and encrypted CV) Tj ET");
  const objectKey = md5(key, Buffer.from([4, 0, 0, 0, 0])).subarray(0, 10); // object 4, generation 0
  const encContent = rc4(objectKey, content);
  const hex = (b: Buffer) => `<${b.toString("hex")}>`;

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  const add = (...chunks: (string | Buffer)[]) => {
    offsets.push(parts.reduce((n, p) => n + p.length, 0));
    parts.push(...chunks.map((c) => (typeof c === "string" ? Buffer.from(c, "latin1") : c)));
  };
  add("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  add("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  add("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n");
  add(`4 0 obj\n<< /Length ${encContent.length} >>\nstream\n`, encContent, "\nendstream\nendobj\n");
  add("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  add(`6 0 obj\n<< /Filter /Standard /V 1 /R 2 /O ${hex(o)} /U ${hex(u)} /P -4 >>\nendobj\n`);
  const xrefAt = parts.reduce((n, p) => n + p.length, 0);
  const xref = ["xref", `0 ${offsets.length + 1}`, "0000000000 65535 f "];
  for (const off of offsets) xref.push(`${String(off).padStart(10, "0")} 00000 n `);
  parts.push(
    Buffer.from(`${xref.join("\n")}\ntrailer\n<< /Size ${offsets.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [${hex(id)} ${hex(id)}] >>\nstartxref\n${xrefAt}\n%%EOF\n`),
  );
  return Buffer.concat(parts);
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
write("cv-two-column.pdf", await twoColumnPdf());
write("cv-encrypted.pdf", encryptedPdf());
write("cv-corrupt.pdf", Buffer.from("%PDF-1.7\nthis is not a real pdf body\n"));
write("not-a-cv.txt", "Just a plain text file.\n");
console.log(`Wrote fixtures to ${dir}`);
