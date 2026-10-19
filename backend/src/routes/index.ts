import { Router } from "express";
import { RunsController } from "@/controllers/runs.js";
import { createRunsRouter } from "@/routes/runs.js";
import { RunsService } from "@/services/runs.js";
import type { RunStore } from "@/stores/runs.js";
import type { Config } from "@/utils/config.js";

type Deps = { store: RunStore; config: Config; now?: () => Date };

/** Wires store -> service -> controller -> router and mounts each feature's routes. */
export function createRouter({ store, config, now }: Deps): Router {
  const runs = new RunsController(new RunsService({ store, config, now }));

  const router = Router();
  router.use("/runs", createRunsRouter(runs, config));
  return router;
}
