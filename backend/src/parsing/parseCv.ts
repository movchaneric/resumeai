import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { Config } from "@/utils/config.js";
import { ApiError } from "@/utils/errors.js";

type Limits = Config["limits"];

// Guards against a single declared image allocating gigabytes (unpdf README: resource limits are the caller's job).
const MAX_IMAGE_PIXELS = 16_777_216;

const startsWith = (buffer: Buffer, signature: string) => buffer.subarray(0, signature.length).toString("latin1") === signature;

/** Postgres TEXT cannot hold NUL, and PDF extraction can emit it. */
export const stripNul = (text: string) => text.replaceAll("\u0000", "");

type FileKind = "pdf" | "docx";

/** Detects the type from the bytes: a client-supplied MIME type or file name proves nothing. */
function detectKind(buffer: Buffer): FileKind | null {
  if (startsWith(buffer, "%PDF-")) return "pdf";
  if (startsWith(buffer, "PK\u0003\u0004") && buffer.includes("word/document.xml")) return "docx";
  return null;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ApiError("EXTRACTION_FAILED", "Reading the file took too long.")), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function parsePdf(buffer: Buffer, limits: Limits): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer), { maxImageSize: MAX_IMAGE_PIXELS });
  try {
    if (pdf.numPages > limits.maxCvPages) {
      throw new ApiError("TOO_MANY_PAGES", `The CV has ${pdf.numPages} pages; the limit is ${limits.maxCvPages}.`);
    }
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(text) ? text : [text];
    // Count only visible characters, so page separators and blank lines cannot make a scan look like text.
    const visibleChars = pages.join("").replace(/\s/g, "").length;
    if (visibleChars / pdf.numPages < limits.minPdfCharsPerPage) {
      throw new ApiError("SCANNED_PDF", "This PDF has no readable text; it looks like a scan. Upload a text-based PDF or a DOCX.");
    }
    return pages.join("\n\n").trim();
  } finally {
    await pdf.loadingTask.destroy();
  }
}

async function parseDocx(buffer: Buffer, limits: Limits): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer });
  const text = value.trim();
  if (!text) throw new ApiError("EXTRACTION_FAILED", "No text could be read from the document.");
  // A DOCX has no reliable page count without rendering it, so its length is capped in characters instead.
  if (text.length > limits.maxDocxChars) {
    throw new ApiError("TOO_MANY_PAGES", "The CV is too long.");
  }
  return text;
}

/** Turns an uploaded CV into plain text, or throws an `ApiError` that says why it was rejected. The buffer is not kept. */
export async function parseCv(buffer: Buffer, limits: Limits): Promise<string> {
  if (buffer.length > limits.maxCvBytes) {
    throw new ApiError("FILE_TOO_LARGE", `The file is larger than ${Math.round(limits.maxCvBytes / 1024 / 1024)} MB.`);
  }
  const kind = detectKind(buffer);
  if (!kind) throw new ApiError("UNSUPPORTED_FILE", "Only PDF and DOCX files are supported.");

  try {
    return stripNul(await withTimeout(kind === "pdf" ? parsePdf(buffer, limits) : parseDocx(buffer, limits), limits.parseTimeoutMs));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("EXTRACTION_FAILED", "The file could not be read. It may be corrupt or password-protected.");
  }
}
