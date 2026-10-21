import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApiError } from "@/utils/errors.js";
import { loadConfig } from "@/utils/config.js";
import { parseCv } from "@/parsing/parseCv.js";

const fixture = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures", name));
const { limits } = loadConfig({ DATABASE_URL: "x" });

async function rejection(buffer: Buffer): Promise<ApiError> {
  const error = await parseCv(buffer, limits).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("parseCv", () => {
  it("extracts text from a PDF", async () => {
    const text = await parseCv(fixture("cv.pdf"), limits);
    expect(text).toContain("Jane Doe");
    expect(text).toContain("PostgreSQL");
  });

  it("extracts text from a DOCX", async () => {
    const text = await parseCv(fixture("cv.docx"), limits);
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Senior Backend Developer");
  });

  it("rejects an unsupported file type", async () => {
    expect((await rejection(fixture("not-a-cv.txt"))).code).toBe("UNSUPPORTED_FILE");
  });

  it("detects the type from the bytes, not from a name or MIME type", async () => {
    expect((await rejection(Buffer.from("PK\u0003\u0004 not a docx"))).code).toBe("UNSUPPORTED_FILE");
  });

  it("reads the ZIP directory instead of searching for the DOCX entry name in the bytes", async () => {
    expect((await rejection(Buffer.from("PK\u0003\u0004 mentions word/document.xml but has no such entry"))).code).toBe("UNSUPPORTED_FILE");
  });

  it("rejects a PDF with too many pages", async () => {
    expect((await rejection(fixture("cv-six-pages.pdf"))).code).toBe("TOO_MANY_PAGES");
  });

  it("rejects a scanned PDF", async () => {
    expect((await rejection(fixture("cv-scanned.pdf"))).code).toBe("SCANNED_PDF");
  });

  it("rejects a corrupt PDF as an extraction failure", async () => {
    expect((await rejection(fixture("cv-corrupt.pdf"))).code).toBe("UNREADABLE_FILE");
  });

  describe("PDF reading order", () => {
    it("reads a two-column PDF as the sidebar block and the main block, never interleaved", async () => {
      const text = await parseCv(fixture("cv-two-column.pdf"), limits);
      console.log(`cv-two-column.pdf as extracted:\n${text}`);
      const lines = text.split("\n");
      const at = (needle: string) => lines.findIndex((l) => l.includes(needle));

      expect(at("Jane Doe")).toBeGreaterThanOrEqual(0);
      expect(at("Jane Doe")).toBeLessThan(at("Backend developer with six years"));

      // Each job's date range sits on its title line, separated from it rather than glued to it.
      expect(lines.find((l) => l.includes("Senior Backend Developer"))).toMatch(/Acme Corp {2,}2021 - Present$/);
      expect(lines.find((l) => l.includes("Backend Developer, Initech"))).toMatch(/Initech {2,}2018 - 2021$/);
      expect(lines.find((l) => l.includes("BSc Computer Science"))).toMatch(/University {2,}2014 - 2018$/);

      // Blocks: every sidebar line comes before every main line, or every main line before every sidebar line.
      const sidebar = ["Jane Doe", "CONTACT", "jane.doe@example.com", "SKILLS", "Docker, AWS"].map(at);
      const main = ["SUMMARY", "EXPERIENCE", "Initech", "EDUCATION"].map(at);
      expect(Math.max(...sidebar) < Math.min(...main) || Math.max(...main) < Math.min(...sidebar)).toBe(true);
      // Within the main block the sections keep their order.
      expect(at("SUMMARY")).toBeLessThan(at("EXPERIENCE"));
      expect(at("EXPERIENCE")).toBeLessThan(at("EDUCATION"));
    });
  });

  it("rejects an encrypted PDF", async () => {
    expect((await rejection(fixture("cv-encrypted.pdf"))).code).toBe("UNREADABLE_FILE");
  });

  it("rejects a parse that takes too long", async () => {
    const impatient = { ...limits, parseTimeoutMs: 1 };
    const error = await parseCv(fixture("cv.pdf"), impatient).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("UNREADABLE_FILE");
  });

  it("rejects a DOCX with too much text", async () => {
    const small = { ...limits, maxDocxChars: 20 };
    const error = await parseCv(fixture("cv.docx"), small).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("TOO_MANY_PAGES");
  });

  it("rejects a file over the size limit", async () => {
    expect((await rejection(fixture("cv-oversized.pdf"))).code).toBe("FILE_TOO_LARGE");
  });
});
