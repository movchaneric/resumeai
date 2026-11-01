import express, { Router, type RequestHandler } from "express";
import multer from "multer";
import type { Config } from "@/utils/config.js";
import type { AccountsService } from "@/auth/accounts.js";
import { optionalAccount, requireAccount } from "@/middleware/accounts.js";
import type { RunsController } from "@/controllers/runs.js";

/** `accounts` is absent in a test that does not set up accounts: every viewer is then a guest, and My Runs and claim are not mounted. */
export function createRunsRouter(controller: RunsController, { limits }: Config, accounts?: AccountsService): Router {
  // Memory storage: an upload never touches disk, so there is nothing to delete after parsing (ADR 0002).
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limits.maxCvBytes, files: 1, fields: 4, parts: 6, fieldNameSize: 100, fieldSize: limits.maxJobDescriptionChars * 4 },
  });

  // Who is asking, for the owner check in the service. Before the upload, so a guest and an Account take the same path.
  const viewer: RequestHandler = accounts ? optionalAccount(accounts) : (req, _res, next) => {
    req.account = null;
    next();
  };

  const router = Router();
  if (accounts) {
    router.get("/", requireAccount(accounts), controller.list);
    // The IDs of a few Guest Runs: a small body.
    router.post("/claim", requireAccount(accounts), express.json({ limit: "16kb" }), controller.claim);
  }
  router.post("/", viewer, upload.single("cv"), controller.create);
  router.get("/:id", viewer, controller.get);
  router.delete("/:id", viewer, controller.remove);
  router.get("/:id/events", viewer, controller.events);
  router.get("/:id/cv.docx", viewer, controller.download("docx"));
  router.get("/:id/cv.pdf", viewer, controller.download("pdf"));
  // Answers are a few short texts: a small limit keeps a large body out of memory.
  router.post("/:id/answers", viewer, express.json({ limit: "64kb" }), controller.answer);
  // A decision per Change, with the user's text for the revised ones: bigger than Answers, still small.
  router.post("/:id/review", viewer, express.json({ limit: "256kb" }), controller.review);
  // The same body, to ask whether the result fits one page; nothing is submitted.
  router.post("/:id/review/preview", viewer, express.json({ limit: "256kb" }), controller.previewReview);
  return router;
}
