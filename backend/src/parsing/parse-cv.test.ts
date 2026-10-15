import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ApiError } from "../errors.js";
import { loadConfig } from "../config.js";
import { parseCv } from "./parse-cv.js";

const fixture = (name: string) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures", name));
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

  it("rejects a PDF with too many pages", async () => {
    expect((await rejection(fixture("cv-six-pages.pdf"))).code).toBe("TOO_MANY_PAGES");
  });

  it("rejects a scanned PDF", async () => {
    expect((await rejection(fixture("cv-scanned.pdf"))).code).toBe("SCANNED_PDF");
  });

  it("rejects a corrupt PDF as an extraction failure", async () => {
    expect((await rejection(fixture("cv-corrupt.pdf"))).code).toBe("EXTRACTION_FAILED");
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
