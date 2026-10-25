import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

/** ADR 0005: the checkpointer's tables live in their own schema, apart from `app`. */
export const CHECKPOINT_SCHEMA = "checkpoints";

/**
 * The production checkpointer, with its own connection pool. Call `setup()` once before the server listens,
 * and `end()` on shutdown. The URL must not carry Prisma's `schema` parameter, so it is removed here.
 */
export function createPostgresCheckpointer(databaseUrl: string): PostgresSaver {
  const url = new URL(databaseUrl);
  url.searchParams.delete("schema");
  return PostgresSaver.fromConnString(url.toString(), { schema: CHECKPOINT_SCHEMA });
}
