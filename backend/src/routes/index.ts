import { Router } from "express";
import { RunsController } from "@/controllers/runs.js";
import { createRunsRouter } from "@/routes/runs.js";
import { RunsService, type RunsDeps } from "@/services/runs.js";

/** Wires store -> service -> controller -> router and mounts each feature's routes. */
export function createRouter(deps: RunsDeps, service: RunsService): Router {
  const runs = new RunsController(service, deps.config.sseHeartbeatMs);

  const router = Router();
  router.use("/runs", createRunsRouter(runs, deps.config));
  return router;
}
