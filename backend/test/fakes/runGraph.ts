import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import { LangGraphRunner, type StatusWriter } from "@/graph/runner.js";
import type { LlmClient } from "@/llm/llmClient.js";

/** The real Run graph and runner on an in-memory checkpointer, so no database is needed. */
export function makeGraphRunner(statuses: StatusWriter, llm: LlmClient, judgeLlm: LlmClient = llm): LangGraphRunner {
  return new LangGraphRunner({ llm, judgeLlm, checkpointer: createMemoryCheckpointer() }, statuses);
}
