import express, { Router } from "express";
import multer from "multer";
import type { Config } from "@/utils/config.js";
import type { RunsController } from "@/controllers/runs.js";

export function createRunsRouter(controller: RunsController, { limits }: Config): Router {
  // Memory storage: an upload never touches disk, so there is nothing to delete after parsing (ADR 0002).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limits.maxCvBytes, files: 1, fields: 4, parts: 6, fieldNameSize: 100, fieldSize: limits.maxJobDescriptionChars * 4 },
  });

  const router = Router();
  router.post("/", upload.single("cv"), controller.create);
  router.get("/:id", controller.get);
  // Answers are a few short texts: a small limit keeps a large body out of memory.
  router.post("/:id/answers", express.json({ limit: "64kb" }), controller.answer);
  return router;
}
