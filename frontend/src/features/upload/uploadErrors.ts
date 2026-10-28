import type { RunErrorCode } from "@resume-ai/shared";
import { ApiError } from "@/api";

export const MAX_CV_BYTES = 5 * 1024 * 1024;
export const MAX_JD_CHARS = 20_000;

export interface Problem {
  title: string;
  hint: string;
}
export type Pane = "cv" | "jd" | "form";
export interface Rejection extends Problem {
  pane: Pane;
}

type Known = Extract<RunErrorCode, "UNSUPPORTED_FILE" | "FILE_TOO_LARGE" | "TOO_MANY_PAGES" | "SCANNED_PDF" | "UNREADABLE_FILE" | "JOB_DESCRIPTION_TOO_LONG">;

const KNOWN: Record<Known, Rejection> = {
  UNSUPPORTED_FILE: { pane: "cv", title: "This file type isn't supported.", hint: "Upload a PDF or a Word (.docx) file." },
  FILE_TOO_LARGE: { pane: "cv", title: "This file is over 5 MB.", hint: "Save a smaller copy, or export it again without images." },
  TOO_MANY_PAGES: { pane: "cv", title: "This CV is longer than 5 pages.", hint: "Upload a shorter version." },
  SCANNED_PDF: { pane: "cv", title: "This PDF looks scanned: there's no text to read.", hint: "Export it from your editor as PDF or Word instead of scanning." },
  UNREADABLE_FILE: { pane: "cv", title: "We couldn't read this file.", hint: "Check that it opens, then try again, or try the other format." },
  JOB_DESCRIPTION_TOO_LONG: { pane: "jd", title: "The Job Description is over 20,000 characters.", hint: "Remove the company boilerplate and keep the role and its requirements." },
};

/** Where a rejection shows and what it says. Unknown codes and network errors go above the footer; the server's message is their fallback. */
export function rejectionFor(error: unknown): Rejection {
  if (error instanceof ApiError && error.code in KNOWN) return KNOWN[error.code as Known];
  const fallback = error instanceof ApiError && !error.isNetworkError && !error.isParseError ? error.message : "";
  return { pane: "form", title: "Something went wrong on our side.", hint: fallback && fallback !== "Something went wrong." ? fallback : "Try again in a moment." };
}

/** Client check of a chosen CV: the type (PDF or .docx) and the size. */
export function checkFile(file: File): Rejection | null {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".pdf") && !name.endsWith(".docx")) return KNOWN.UNSUPPORTED_FILE;
  if (file.size > MAX_CV_BYTES) return KNOWN.FILE_TOO_LARGE;
  return null;
}

export const checkJobDescription = (text: string): Rejection | null => (text.length > MAX_JD_CHARS ? KNOWN.JOB_DESCRIPTION_TOO_LONG : null);

export const MISSING_FILE: Problem = { title: "Choose your CV.", hint: "Upload a PDF or a Word (.docx) file." };
export const MISSING_JD: Problem = { title: "Paste the Job Description.", hint: "Paste the whole posting, requirements included." };

export function describeFile(file: File): string {
  const kind = file.name.toLowerCase().endsWith(".pdf") ? "PDF" : "Word";
  const size = file.size >= 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
  return `${kind} · ${size}`;
}
