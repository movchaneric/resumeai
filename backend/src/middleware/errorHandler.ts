import type { ErrorRequestHandler, RequestHandler } from "express";
import { MulterError } from "multer";
import { ApiError } from "@/utils/errors.js";

/** Unknown paths answer with the same JSON shape as every other error. `RUN_NOT_FOUND` is kept for Run IDs. */
export const notFound: RequestHandler = (_req, _res, next) => next(new ApiError("NOT_FOUND", "Not found."));

export const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) return next(error);
  const apiError = toApiError(error);
  if (apiError.code === "INTERNAL") console.error(error);
  res.status(apiError.status).json({ code: apiError.code, message: apiError.message });
};

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") return new ApiError("FILE_TOO_LARGE", "The file is too large.");
    if (error.code === "LIMIT_FIELD_VALUE") return new ApiError("JOB_DESCRIPTION_TOO_LONG", "The job description is too long.");
    return new ApiError("BAD_REQUEST", "The upload is not valid.");
  }
  return new ApiError("INTERNAL", "Something went wrong.");
}
