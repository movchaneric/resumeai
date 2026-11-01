import { Router } from "express";
import type { AccountsService } from "@/auth/accounts.js";
import { AccountController } from "@/controllers/account.js";
import { RunsController } from "@/controllers/runs.js";
import { createAccountRouter } from "@/routes/account.js";
import { createRunsRouter } from "@/routes/runs.js";
import { AccountDeletionService } from "@/services/accounts.js";
import { RunsService, type RunsDeps } from "@/services/runs.js";
import type { OpenStreams } from "@/utils/openStreams.js";

/** Takes the built service (store -> service is wired by the caller), wires controller -> router and mounts each feature's routes. `accounts` is absent in a test that does not set up accounts. */
export function createRouter(deps: RunsDeps, service: RunsService, streams: OpenStreams, accounts?: AccountsService): Router {
  const runs = new RunsController(service, deps.config.sseHeartbeatMs, streams);

  const router = Router();
  router.use("/runs", createRunsRouter(runs, deps.config, accounts));
  if (accounts) router.use("/account", createAccountRouter(new AccountController(new AccountDeletionService({ runs: service, accounts })), accounts));
  return router;
}
