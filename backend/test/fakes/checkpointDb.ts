import pg from "pg";
import { createPostgresCheckpointer } from "@/graph/checkpointer.js";

/** The checkpoint tables that hold rows keyed by `thread_id` (the Run id). */
export const CHECKPOINT_TABLES = ["checkpoints", "checkpoint_blobs", "checkpoint_writes"];

/**
 * A real Postgres checkpointer and a pool on the same database, for tests that must see what is left in the checkpoint
 * tables. Call `checkpointer.setup()` before use and `end()` after.
 */
export function createCheckpointDb(url = process.env.DATABASE_URL!) {
  const pool = new pg.Pool({ connectionString: url });
  const checkpointer = createPostgresCheckpointer(`${url}?schema=app`);
  return {
    pool,
    checkpointer,
    /** How many rows `table` holds for the Run's thread. */
    rowsFor: async (table: string, id: string): Promise<number> =>
      (await pool.query(`SELECT count(*)::int AS n FROM checkpoints.${table} WHERE thread_id = $1`, [id])).rows[0].n as number,
    async end(): Promise<void> {
      await checkpointer.end();
      await pool.end();
    },
  };
}
