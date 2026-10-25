// Prepares the integration-test database before any test runs: creates it when missing and applies every migration,
// so the tests exercise the real migrations without a manual step. Needs `docker compose up -d postgres`.
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** Test database name for a repo checkout: the folder name lowercased, each run of non-`[a-z0-9]` characters replaced by `_`, plus `_test`. `resume-ai` gives `resume_ai_test`; a worktree `resume-ai-wt-05` gives `resume_ai_wt_05_test`. */
export function testDatabaseName(repoRoot: string): string {
  return `${basename(repoRoot).toLowerCase().replace(/[^a-z0-9]+/g, "_")}_test`;
}

const backendDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Defaults to a database named after the checkout folder, so parallel worktrees do not share one. Override with `TEST_DATABASE_URL` to use any other database. Read by `vitest.config.ts` too: `test.env` is not visible here, because global setup runs in the main process. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? `postgresql://resume:resume@localhost:15432/${testDatabaseName(join(backendDir, ".."))}`;

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
