import type { RunErrorCode } from "@resume-ai/shared";

/** Codes returned by the HTTP API: every `RunErrorCode` plus errors that never belong to a Run. */
export type ApiErrorCode = RunErrorCode | "BAD_REQUEST" | "RUN_NOT_FOUND" | "NOT_FOUND";

const STATUS: Record<ApiErrorCode, number> = {
  UNSUPPORTED_FILE: 415,
  FILE_TOO_LARGE: 413,
  JOB_DESCRIPTION_TOO_LONG: 413,
  TOO_MANY_PAGES: 422,
  SCANNED_PDF: 422,
  UNREADABLE_FILE: 422,
  // The next two are Run failures, never HTTP responses; STATUS is keyed by every code.
  EXTRACTION_FAILED: 422,
  NO_REQUIREMENTS: 422,
  INTERNAL: 500,
  BAD_REQUEST: 400,
  RUN_NOT_FOUND: 404,
  NOT_FOUND: 404,
};

/** A request that is rejected at the door. No Run is created for it. */
export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = STATUS[code];
  }
}
