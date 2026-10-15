import { randomUUID } from "node:crypto";
import express, { type ErrorRequestHandler, type Express } from "express";
import multer, { MulterError } from "multer";
import { RunIdSchema } from "@resume-ai/shared";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";
import { parseCv, stripNul } from "./parsing/parse-cv.js";
import type { RunStore } from "./run-store.js";
import { toRunView } from "./run-view.js";

type Deps = { store: RunStore; config: Config; now?: () => Date };

export function createApp({ store, config, now = () => new Date() }: Deps): Express {
  const { limits } = config;
  // Memory storage: an upload never touches disk, so there is nothing to delete after parsing (ADR 0002).
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: limits.maxCvBytes, files: 1, fields: 4, parts: 6, fieldNameSize: 100, fieldSize: limits.maxJdChars * 4 } });

  const app = express();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/runs", upload.single("cv"), async (req, res) => {
    const jobDescription = typeof req.body?.jobDescription === "string" ? stripNul(req.body.jobDescription).trim() : "";
    if (!req.file) throw new ApiError("BAD_REQUEST", "Upload your CV in the `cv` field.");
    if (!jobDescription) throw new ApiError("BAD_REQUEST", "The `jobDescription` field is required.");
    if (jobDescription.length > limits.maxJdChars) {
      throw new ApiError("JOB_DESCRIPTION_TOO_LONG", `The job description is longer than ${limits.maxJdChars} characters.`);
    }

    const cvText = await parseCv(req.file.buffer, limits);
    const created = now();
    const run = await store.create({
      id: RunIdSchema.parse(randomUUID()),
      status: "extracting",
      expiresAt: new Date(created.getTime() + config.runTtlMs),
      cvText,
      jdText: jobDescription,
    });
    res.status(201).location(`/runs/${run.id}`).json({ id: run.id });
  });

  app.get("/runs/:id", async (req, res) => {
    // A malformed, unknown or expired ID all look the same, so an ID reveals nothing about whether it ever existed.
    const id = RunIdSchema.safeParse(req.params.id);
    const run = id.success ? await store.get(id.data) : null;
    if (!run || run.expiresAt <= now()) throw new ApiError("RUN_NOT_FOUND", "Run not found.");
    res.json(toRunView(run));
  });

  app.use((_req, _res, next) => next(new ApiError("RUN_NOT_FOUND", "Not found.")));

  const onError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const apiError = toApiError(error);
    if (apiError.code === "INTERNAL") console.error(error);
    res.status(apiError.status).json({ code: apiError.code, message: apiError.message });
  };
  app.use(onError);

  return app;
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") return new ApiError("FILE_TOO_LARGE", "The file is too large.");
    if (error.code === "LIMIT_FIELD_VALUE") return new ApiError("JOB_DESCRIPTION_TOO_LONG", "The job description is too long.");
    return new ApiError("BAD_REQUEST", "The upload is not valid.");
  }
  return new ApiError("INTERNAL", "Something went wrong.");
}
