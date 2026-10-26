import { Command } from "@langchain/langgraph";
import type { Answer, RunId, RunStatus } from "@resume-ai/shared";
import type { GraphRunner, RunSnapshot, StartRunInput } from "@/services/runs.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { withSessionSpan } from "@/utils/spans.js";
import type { LlmClient } from "@/llm/llmClient.js";
import { NODE_STATUS, buildRunGraph, type RoundSummary, type RunGraph } from "@/graph/runGraph.js";
import type { JobProfileCache } from "@/graph/jobProfileCache.js";
import type { RunStateValues } from "@/graph/state.js";

/** The part of the runs store the graph runner needs. */
export interface StatusWriter {
  setStatus(id: RunId, status: RunStatus): Promise<void>;
}

const statusOf = (node: string): RunStatus | undefined => (NODE_STATUS as Record<string, RunStatus>)[node];

function toSnapshot(values: Partial<RunStateValues>): RunSnapshot {
  return {
    jobProfile: values.jobProfile ?? null,
    cv: values.cv ?? null,
    coverageBefore: values.coverageBefore ?? null,
    coverage: values.coverage ?? null,
    changes: values.changes ?? [],
    scoreBefore: values.scoreBefore ?? null,
    scoreAfter: values.scoreAfter ?? null,
    rejections: values.rejections ?? [],
    questions: values.questions ?? [],
    userEvidence: values.userEvidence ?? [],
    confirmedGaps: values.confirmedGaps ?? [],
    rounds: values.rounds ?? 0,
    exitReason: values.exitReason ?? null,
  };
}

/**
 * Runs the Run graph with `thread_id` = the Run id, and keeps the Run's `status` in step with the node the
 * graph is in. The only place outside the graph that talks to LangGraph; no LangGraph type crosses its interface.
 * A failure before the first score rejects `start` with the original error; the service turns it into `failed`.
 */
export class LangGraphRunner implements GraphRunner {
  private readonly graph: RunGraph;
  /** The last status written per running Run, so a node that shares its predecessor's status writes nothing. */
  private readonly lastWritten = new Map<string, RunStatus>();

  constructor(
    deps: {
      llm: LlmClient;
      judgeLlm: LlmClient;
      judgeModel: string;
      jobProfileCache: JobProfileCache;
      checkpointer: BaseCheckpointSaver;
      onRound?: (summary: RoundSummary) => void;
    },
    private readonly statuses: StatusWriter,
  ) {
    this.graph = buildRunGraph({
      ...deps,
      onEnter: (runId, node) => this.write(runId as RunId, NODE_STATUS[node]),
    });
  }

  private async write(runId: RunId, status: RunStatus): Promise<void> {
    if (this.lastWritten.get(runId) === status) return;
    this.lastWritten.set(runId, status);
    await this.statuses.setStatus(runId, status);
  }

  async start({ runId, cvText, jobDescriptionText }: StartRunInput): Promise<RunSnapshot> {
    return this.runUntilPause(runId, { runId, cvText, jobDescriptionText });
  }

  /**
   * Resumes the Run paused in `collect_answers`, with the Answers as the value of its `interrupt()`. The resumed work
   * is a new root span with the Run id as `session.id`, like the one the service opens around `start`.
   */
  async answer(runId: RunId, answers: Answer[]): Promise<RunSnapshot> {
    return withSessionSpan("answers", runId, () => this.runUntilPause(runId, new Command({ resume: answers })));
  }

  /** Runs the graph from `input` until it ends or pauses, and writes the status of the pause. */
  private async runUntilPause(runId: RunId, input: Parameters<RunGraph["invoke"]>[0]): Promise<RunSnapshot> {
    const config = { configurable: { thread_id: runId } };
    try {
      await this.graph.invoke(input, config);
      // The graph stops before `review` and inside `collect_answers`, so those nodes' statuses are written at the pause.
      const state = await this.graph.getState(config);
      if (state.next.length > 0) await this.write(runId, statusOf(state.next[0]!) ?? "awaiting_review");
      return toSnapshot(state.values);
    } finally {
      this.lastWritten.delete(runId);
    }
  }

  async read(runId: RunId): Promise<RunSnapshot | null> {
    const state = await this.graph.getState({ configurable: { thread_id: runId } });
    return state.createdAt === undefined ? null : toSnapshot(state.values);
  }
}
