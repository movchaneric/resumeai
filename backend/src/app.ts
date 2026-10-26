import express, { type Express } from "express";
import { errorHandler, notFound } from "@/middleware/errorHandler.js";
import { createRouter } from "@/routes/index.js";
import { RunsService, type RunsDeps } from "@/services/runs.js";

/** `service` is for a caller that needs the same instance (the server entry point runs recovery on it). */
export function createApp(deps: RunsDeps, service: RunsService = new RunsService(deps)): Express {
  const app = express();
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use(createRouter(deps, service));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
