import { Command } from "@langchain/langgraph";
import type { Answer, RunId, RunStatus } from "@resume-ai/shared";
import type { GraphRunner, RunEvents, RunSnapshot, StartRunInput } from "@/services/runs.js";
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

/** Where the graph is stopped, from the nodes it runs next: `collect_answers` waits for Answers, `review` for the user. */
function pausedAtOf(next: readonly string[]): RunSnapshot["pausedAt"] {
  if (next.includes("collect_answers")) return "answers";
  // Nothing left to run also reads as review: the graph only ends after review, which no slice reaches yet.
  if (next.length === 0 || next.includes("review")) return "review";
  return null;
}

function toSnapshot(values: Partial<RunStateValues>, next: readonly string[]): RunSnapshot {
  return {
    pausedAt: pausedAtOf(next),
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
    private readonly events: Pick<RunEvents, "publish">,
  ) {
    this.graph = buildRunGraph({
      ...deps,
      onEnter: async (runId, node) => {
        await this.write(runId as RunId, NODE_STATUS[node]);
        // Deliberate: the push for node N happens when node N+1 is entered (or after the graph returns, see
        // `runUntilPause`). With `durability: "sync"` node N's checkpoint is already stored by then, so a view built now
        // shows its results; that is equivalent to pushing after each node ends. A node that shares its predecessor's
        // status writes nothing but still publishes.
        this.events.publish(runId as RunId);
      },
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

  /**
   * Carries on a Run the process stopped in: runs the graph from its last checkpoint, with no new input, until the next
   * pause or the end. The node that was cut off runs again from its start. Rejects with the original error, like `start`.
   */
  async recover(runId: RunId): Promise<RunSnapshot> {
    return this.runUntilPause(runId, null);
  }

  /** Runs the graph from `input` until it ends or pauses, and writes the status of the pause. */
  private async runUntilPause(runId: RunId, input: Parameters<RunGraph["invoke"]>[0]): Promise<RunSnapshot> {
    const config = { configurable: { thread_id: runId } };
    try {
      // "sync": each step's checkpoint is stored before the next step starts, so the push made when a node is
      // entered (and the one after the last node) always reads that step's results.
      await this.graph.invoke(input, { ...config, durability: "sync" });
      // The graph stops before `review` and inside `collect_answers`, so those nodes' statuses are written at the pause.
      const state = await this.graph.getState(config);
      if (state.next.length > 0) await this.write(runId, statusOf(state.next[0]!) ?? "awaiting_review");
      this.events.publish(runId);
      return toSnapshot(state.values, state.next);
    } finally {
      this.lastWritten.delete(runId);
    }
  }

  async read(runId: RunId): Promise<RunSnapshot | null> {
    const state = await this.graph.getState({ configurable: { thread_id: runId } });
    return state.createdAt === undefined ? null : toSnapshot(state.values, state.next);
  }
}
