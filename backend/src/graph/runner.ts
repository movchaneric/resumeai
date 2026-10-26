import { Command } from "@langchain/langgraph";
import type { Answer, ReviewDecision, RunId, RunStatus } from "@resume-ai/shared";
import type { GraphRunner, RunEvents, RunSnapshot, StartRunInput } from "@/services/runs.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { withSessionSpan } from "@/utils/spans.js";
import type { LlmClient } from "@/llm/llmClient.js";
import { NODE_STATUS, buildRunGraph, type RoundSummary, type RunGraph } from "@/graph/runGraph.js";
import type { JobProfileCache } from "@/graph/jobProfileCache.js";
import type { RunStateValues } from "@/graph/state.js";
import { positionOf, type GraphStateShape } from "@/graph/position.js";

/** The part of the runs store the graph runner needs. */
export interface StatusWriter {
  setStatus(id: RunId, status: RunStatus): Promise<void>;
}

function toSnapshot(state: GraphStateShape & { values: Partial<RunStateValues> }): RunSnapshot {
  const { values } = state;
  return {
    position: positionOf(state),
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
  private readonly checkpointer: BaseCheckpointSaver;
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
    this.checkpointer = deps.checkpointer;
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
   * Resumes the Run paused in `review`, with the decisions as the value of its `interrupt()`, and runs to the end. A new
   * root span with the Run id as `session.id`, like `answer`.
   */
  async review(runId: RunId, decisions: ReviewDecision[]): Promise<RunSnapshot> {
    return withSessionSpan("review", runId, () => this.runUntilPause(runId, new Command({ resume: decisions })));
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
      // `collect_answers` and `review` wait inside `interrupt()`, so their statuses are written at the pause; at the end
      // the Run is `completed`.
      const state = await this.graph.getState(config);
      const snapshot = toSnapshot(state);
      if (snapshot.position === "answers") await this.write(runId, "awaiting_answers");
      else if (snapshot.position === "review") await this.write(runId, "awaiting_review");
      else if (snapshot.position === "ended") await this.write(runId, "completed");
      this.events.publish(runId);
      return snapshot;
    } finally {
      this.lastWritten.delete(runId);
    }
  }

  async deleteThread(runId: RunId): Promise<void> {
    await this.checkpointer.deleteThread(runId);
  }

  async read(runId: RunId): Promise<RunSnapshot | null> {
    const state = await this.graph.getState({ configurable: { thread_id: runId } });
    return state.createdAt === undefined ? null : toSnapshot(state);
  }
}
