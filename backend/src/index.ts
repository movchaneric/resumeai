import "dotenv/config";
import { createApp } from "@/app.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { RunStore } from "@/stores/runs.js";

const config = loadConfig();
const prisma = createPrisma(config.databaseUrl);
const app = createApp({ store: new RunStore(prisma), config });

const server = app.listen(config.port, () => {
  console.log(`backend listening on :${config.port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void prisma.$disconnect().finally(() => process.exit(0)));
  });
}
