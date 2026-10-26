import "dotenv/config";
import { createApp } from "@/app.js";
import { describeLlmSettings, loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { createPostgresCheckpointer } from "@/graph/checkpointer.js";
import { LangGraphRunner } from "@/graph/runner.js";
import { LangChainLlmClient } from "@/llm/langChainLlmClient.js";
import { CheckpointStore } from "@/stores/checkpoints.js";
import { JobProfileStore } from "@/stores/jobProfiles.js";
import { RunsService } from "@/services/runs.js";
import { SweepService } from "@/services/sweep.js";
import { RunStore } from "@/stores/runs.js";
import { OpenStreams } from "@/utils/openStreams.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import { closeServer } from "@/utils/shutdown.js";
import { createSweepScheduler } from "@/utils/sweepScheduler.js";
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
const streams = new OpenStreams();
const sweep = new SweepService({ store, jobProfiles: jobProfileCache, checkpoints: new CheckpointStore(prisma), purgeRun: (id, liveAt, cutOffBefore) => runsService.purgeRun(id, liveAt, cutOffBefore), startedAt });
const sweeper = createSweepScheduler(() => sweep.sweep(), config.sweepIntervalMs);
const app = createApp(runsDeps, runsService, streams);

const server = app.listen(config.port, () => {
  console.log(`backend listening on :${config.port} (${describeLlmSettings(config.llm)})`);
  // In the background, so requests are accepted while cut-off Runs are carried on; it never rejects, but a bug must not crash the server.
  // The first sweep waits for recovery, so a Run being recovered is never deleted halfway through.
  runsService
    .recoverRuns(startedAt)
    .catch((error: unknown) => console.error("Run recovery failed", error))
    .then(() => sweeper.start());
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void (async () => {
      // Open event streams are ended, Runs are not drained; requests in flight finish, and cut-off Runs are picked up by recovery on the next start.
      // First, so no sweep starts after this and one in progress finishes before the pool closes.
      await sweeper.stop();
      await closeServer(server, streams);
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
