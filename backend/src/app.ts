import express, { type Express } from "express";
import type { Config } from "@/config.js";
import { errorHandler, notFound } from "@/middleware/error-handler.js";
import type { RunStore } from "@/runs/run-store.js";
import { RunsController } from "@/runs/runs.controller.js";
import { createRunsRouter } from "@/runs/runs.router.js";
import { RunsService } from "@/runs/runs.service.js";

type Deps = { store: RunStore; config: Config; now?: () => Date };

/** Wires store -> service -> controller -> router. */
export function createApp({ store, config, now }: Deps): Express {
  const controller = new RunsController(new RunsService({ store, config, now }));

  const app = express();
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/runs", createRunsRouter(controller, config));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
