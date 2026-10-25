import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";

/** A checkpointer that keeps state in memory: for the dev script, where no database is wanted. */
export function createMemoryCheckpointer(): BaseCheckpointSaver {
  return new MemorySaver();
}
