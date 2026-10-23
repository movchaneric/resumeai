import "dotenv/config";
import { createApp } from "@/app.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { LangChainLlmClient } from "@/llm/langChainLlmClient.js";
import { RunStore } from "@/stores/runs.js";
import { setupTracing } from "@/utils/tracing.js";

const config = loadConfig();
// Registers the LangChain instrumentation; keep it ahead of anything that builds a model.
const tracingProvider = setupTracing(config);
const prisma = createPrisma(config.databaseUrl);
const app = createApp({ store: new RunStore(prisma), config, llm: new LangChainLlmClient(config.llm) });

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
        await prisma.$disconnect().catch(() => {});
        process.exit(0);
      })();
    });
  });
}
