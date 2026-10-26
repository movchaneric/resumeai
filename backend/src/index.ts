import "dotenv/config";
import { createApp } from "@/app.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { createPostgresCheckpointer } from "@/graph/checkpointer.js";
import { LangGraphRunner } from "@/graph/runner.js";
import { LangChainLlmClient } from "@/llm/langChainLlmClient.js";
import { JobProfileStore } from "@/stores/jobProfiles.js";
import { RunStore } from "@/stores/runs.js";
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
const graphRunner = new LangGraphRunner({ llm, judgeLlm, judgeModel: config.llm.judgeModel, jobProfileCache, checkpointer }, store);
const app = createApp({ store, config, graphRunner });

const server = app.listen(config.port, () => {
  console.log(`backend listening on :${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void (async () => {
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
  });
}
