import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import { LangGraphRunner, type StatusWriter } from "@/graph/runner.js";
import type { LlmClient } from "@/llm/llmClient.js";
import type { GraphRunner, RunEvents } from "@/services/runs.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import { FakeJobProfileCache } from "./jobProfileCache.js";

/** The real Run graph and runner on an in-memory checkpointer and an in-memory Job Profile cache, so no database is needed. */
export function makeGraphRunner(
  statuses: StatusWriter,
  llm: LlmClient,
  judgeLlm: LlmClient = llm,
  jobProfileCache: FakeJobProfileCache = new FakeJobProfileCache(),
  events: Pick<RunEvents, "publish"> = new InProcessRunEvents(),
  checkpointer: BaseCheckpointSaver = createMemoryCheckpointer(),
): LangGraphRunner {
  return new LangGraphRunner(
    { llm, judgeLlm, judgeModel: "test-judge", jobProfileCache, checkpointer },
    statuses,
    events,
  );
}

/**
 * Wraps a runner so a Run that pauses for Answers is resumed at once with none (every Question skipped), for tests that
 * are about something other than Questions. The resumed work runs inside whatever span is active, as in `start`.
 */
export function skipQuestions(inner: GraphRunner): GraphRunner {
  return {
    async start(input) {
      const snapshot = await inner.start(input);
      return snapshot.questions.length > 0 && snapshot.exitReason === null ? inner.answer(input.runId, []) : snapshot;
    },
    answer: (runId, answers) => inner.answer(runId, answers),
    review: (runId, decisions, drops) => inner.review(runId, decisions, drops),
    recover: (runId) => inner.recover(runId),
    read: (runId) => inner.read(runId),
    deleteThread: (runId) => inner.deleteThread(runId),
  };
}
