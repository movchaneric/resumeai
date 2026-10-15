import express, { type Express } from "express";
import { errorHandler, notFound } from "@/middleware/errorHandler.js";
import { createRouter } from "@/routes/index.js";
import type { RunStore } from "@/stores/runStore.js";
import type { Config } from "@/utils/config.js";

type Deps = { store: RunStore; config: Config; now?: () => Date };

export function createApp(deps: Deps): Express {
  const app = express();
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use(createRouter(deps));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
