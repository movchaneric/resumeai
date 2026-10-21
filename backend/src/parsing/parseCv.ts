import mammoth from "mammoth";
import { extractTextItems, getDocumentProxy } from "unpdf";
import { layoutPage } from "@/parsing/pdfLayout.js";
import type { Config } from "@/utils/config.js";
import { ApiError } from "@/utils/errors.js";

type Limits = Config["limits"];

// Guards against a single declared image allocating gigabytes (unpdf README: resource limits are the caller's job).
const MAX_IMAGE_PIXELS = 16_777_216;

const startsWith = (buffer: Buffer, signature: string) => buffer.subarray(0, signature.length).toString("latin1") === signature;

/** Postgres TEXT cannot hold NUL, and PDF extraction can emit it. */
export const stripNul = (text: string) => text.replaceAll("\u0000", "");

type FileKind = "pdf" | "docx";

const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_CENTRAL_DIRECTORY_ENTRY = 0x02014b50;

/**
 * Lists the entry names in a ZIP's central directory, or returns null when the directory cannot be read.
 * Reading the directory, not searching the bytes, means a ZIP that merely contains the text "word/document.xml" is not a DOCX.
 */
function zipEntryNames(buffer: Buffer): string[] | null {
  // The end record is 22 bytes plus a comment of up to 65,535 bytes, so it sits within that distance of the end.
  const searchFrom = Math.max(0, buffer.length - 22 - 0xffff);
  let end = -1;
  for (let i = buffer.length - 22; i >= searchFrom; i--) {
    if (buffer.readUInt32LE(i) === ZIP_END_OF_CENTRAL_DIRECTORY) {
      end = i;
      break;
    }
  }
  if (end < 0) return null;

  const entries = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_DIRECTORY_ENTRY) return null;
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

/** Detects the type from the bytes: a client-supplied MIME type or file name proves nothing. */
function detectKind(buffer: Buffer): FileKind | null {
  if (startsWith(buffer, "%PDF-")) return "pdf";
  if (startsWith(buffer, "PK\u0003\u0004") && zipEntryNames(buffer)?.includes("word/document.xml")) return "docx";
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
    // Positioned items, not unpdf's storage-order text: two-column CVs need their reading order rebuilt.
    const { items } = await extractTextItems(pdf);
    const pages = await Promise.all(
      items.map(async (pageItems, i) => {
        const [x0, , x1] = (await pdf.getPage(i + 1)).view as number[];
        return layoutPage(pageItems, (x1 ?? 0) - (x0 ?? 0));
      }),
    );
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
