// Prepares the integration-test database before any test runs: creates it when missing and applies every migration,
// so the tests exercise the real migrations without a manual step. Needs `docker compose up -d postgres`.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** Read by `vitest.config.ts` too: `test.env` is not visible here, because global setup runs in the main process. */
export const TEST_DATABASE_URL = "postgresql://resume:resume@localhost:15432/resume_ai_test";

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");

async function createDatabaseIfMissing(url: URL): Promise<void> {
  const name = url.pathname.slice(1);
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";

  const client = new pg.Client({ connectionString: maintenance.toString() });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(`Cannot reach Postgres at ${maintenance.host}. Start it with \`docker compose up -d postgres\`.`, { cause: error });
  }
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (!rowCount) await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
  } finally {
    await client.end();
  }
}

export default async function setup(): Promise<void> {
  await createDatabaseIfMissing(new URL(TEST_DATABASE_URL));
  execFileSync(join(backendDir, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
}
