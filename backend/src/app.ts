import express, { type Express } from "express";
import { errorHandler, notFound } from "@/middleware/errorHandler.js";
import { createRouter } from "@/routes/index.js";
import type { RunsDeps } from "@/services/runs.js";

export function createApp(deps: RunsDeps): Express {
  const app = express();
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use(createRouter(deps));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
