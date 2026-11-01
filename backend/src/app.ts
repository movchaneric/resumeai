import express, { type Express } from "express";
import { AUTH_BASE_PATH, type Auth } from "@/auth/betterAuth.js";
import { errorHandler, notFound } from "@/middleware/errorHandler.js";
import { createRouter } from "@/routes/index.js";
import { RunsService, type RunsDeps } from "@/services/runs.js";
import { OpenStreams } from "@/utils/openStreams.js";

/**
 * `service` is for a caller that needs the same instance (the server entry point runs recovery on it); `streams` is for
 * one that needs the registry of open event streams (the entry point ends them on shutdown). `auth` mounts Better Auth and
 * `/account`; a test that has nothing to do with accounts leaves it out.
 */
export function createApp(deps: RunsDeps, service: RunsService = new RunsService(deps), streams: OpenStreams = new OpenStreams(), auth?: Auth): Express {
  const app = express();
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  // Before express.json(): Better Auth reads the raw request body itself.
  if (auth) app.all(`${AUTH_BASE_PATH}/*splat`, auth.handler);
  app.use(createRouter(deps, service, streams, auth?.accounts));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
