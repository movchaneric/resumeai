import "dotenv/config";
import { createApp } from "@/app.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { createPostgresCheckpointer } from "@/graph/checkpointer.js";
import { LangGraphRunner } from "@/graph/runner.js";
import { LangChainLlmClient } from "@/llm/langChainLlmClient.js";
import { JobProfileStore } from "@/stores/jobProfiles.js";
import { RunsService } from "@/services/runs.js";
import { RunStore } from "@/stores/runs.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import { closeServer } from "@/utils/shutdown.js";
import { setupTracing } from "@/utils/tracing.js";

const config = loadConfig();
// Registers the LangChain instrumentation; keep it ahead of anything that builds a model.
const tracingProvider = setupTracing(config);
const prisma = createPrisma(config.databaseUrl);
const llm = new LangChainLlmClient(config.llm);
const judgeLlm = new LangChainLlmClient({ ...config.llm, model: config.llm.judgeModel });
const store = new RunStore(prisma);
const jobProfileCache = new JobProfileStore(prisma, { ttlMs: config.runTtlMs });
const checkpointer = createPostgresCheckpointer(config.databaseUrl);
// Creates the checkpointer's tables in the `checkpoints` schema; the server must not listen before they exist.
await checkpointer.setup();
const events = new InProcessRunEvents();
const graphRunner = new LangGraphRunner({ llm, judgeLlm, judgeModel: config.llm.judgeModel, jobProfileCache, checkpointer }, store, events);
// Runs created before this are cut-off Runs; recovery leaves the ones created after it to this process.
const startedAt = new Date();
const runsDeps = { store, config, graphRunner, events };
const runsService = new RunsService(runsDeps);
const app = createApp(runsDeps, runsService);

const server = app.listen(config.port, () => {
  console.log(`backend listening on :${config.port}`);
  // In the background, so requests are accepted while cut-off Runs are carried on; it never rejects, but a bug must not crash the server.
  runsService.recoverRuns(startedAt).catch((error: unknown) => console.error("Run recovery failed", error));
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      // Open streams are cut, not drained; cut-off Runs are picked up by recovery on the next start.
      await closeServer(server);
      // Flush buffered spans first; a failed flush (Phoenix down) must not block the exit.
      try {
        await tracingProvider?.shutdown();
      } catch (error) {
        console.error("Could not flush traces on shutdown", error);
      }
      await checkpointer.end().catch(() => {});
      await prisma.$disconnect().catch(() => {});
      process.exit(0);
    })();
  });
}
