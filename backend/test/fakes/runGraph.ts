import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import { LangGraphRunner, type StatusWriter } from "@/graph/runner.js";
import type { LlmClient } from "@/llm/llmClient.js";
import { FakeJobProfileCache } from "./jobProfileCache.js";

/** The real Run graph and runner on an in-memory checkpointer and an in-memory Job Profile cache, so no database is needed. */
export function makeGraphRunner(
  statuses: StatusWriter,
  llm: LlmClient,
  judgeLlm: LlmClient = llm,
  jobProfileCache: FakeJobProfileCache = new FakeJobProfileCache(),
): LangGraphRunner {
  return new LangGraphRunner(
    { llm, judgeLlm, judgeModel: "test-judge", jobProfileCache, checkpointer: createMemoryCheckpointer() },
    statuses,
  );
}
