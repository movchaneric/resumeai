import { Router } from "express";
import { RunsController } from "@/controllers/runs.js";
import { createRunsRouter } from "@/routes/runs.js";
import { RunsService, type RunsDeps } from "@/services/runs.js";
import type { OpenStreams } from "@/utils/openStreams.js";

/** Takes the built service (store -> service is wired by the caller), wires controller -> router and mounts each feature's routes. */
export function createRouter(deps: RunsDeps, service: RunsService, streams: OpenStreams): Router {
  const runs = new RunsController(service, deps.config.sseHeartbeatMs, streams);

  const router = Router();
  router.use("/runs", createRunsRouter(runs, deps.config));
  return router;
}
