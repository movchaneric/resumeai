import { END, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import { extractCv } from "@/extraction/extractCv.js";
import { extractJobProfile } from "@/extraction/extractJobProfile.js";
import type { LlmClient } from "@/llm/llmClient.js";
import { assessCoverage } from "@/scoring/assessCoverage.js";
import { matchScore } from "@/scoring/matchScore.js";
import { RunState } from "@/graph/state.js";

/** The Run status a node writes when the graph enters it (decisions record, "Storage and status"). */
export const NODE_STATUS = {
  extract: "extracting",
  assess_coverage: "extracting",
  review: "awaiting_review",
} as const;

export type RunGraphDeps = {
  /** Extraction. */
  llm: LlmClient;
  /** Judge-and-write work (Coverage now; the tailor and claim check later). */
  judgeLlm: LlmClient;
  checkpointer: BaseCheckpointSaver;
  /** Called first thing in each node, so the Run's status is written before the node's work starts. */
  onEnter: (runId: string, node: keyof typeof NODE_STATUS) => Promise<void>;
};

/**
 * The Run workflow (ADR 0001): extract, first Coverage, then the pause before `review`. Nodes are thin: each
 * calls one function from `extraction/` or `scoring/` and returns a state update. Tailoring nodes slot in
 * between `assess_coverage` and `review` in a later ticket.
 */
export function buildRunGraph({ llm, judgeLlm, checkpointer, onEnter }: RunGraphDeps) {
  return new StateGraph(RunState)
    .addNode("extract", async (state) => {
      await onEnter(state.runId, "extract");
      const jobProfile = await extractJobProfile(llm, state.jobDescriptionText);
      const { cv, softMismatches } = await extractCv(llm, state.cvText);
      console.debug(`Run ${state.runId}: extraction done, ${softMismatches} soft mismatches`);
      return { jobProfile, cv };
    })
    .addNode("assess_coverage", async (state) => {
      await onEnter(state.runId, "assess_coverage");
      // Both exist once `extract` has run; the edge order guarantees it.
      const { coverage } = await assessCoverage(judgeLlm, state.cv!, state.jobProfile!.requirements);
      const score = matchScore(state.jobProfile!.requirements, coverage);
      // Without tailoring rounds the result equals the first Coverage. The exit router (later) decides this.
      return { coverageBefore: coverage, coverage, scoreBefore: score, scoreAfter: score, exitReason: "ceiling" as const };
    })
    // The candidate's turn. The graph stops before it; slice 6 resumes it.
    .addNode("review", () => ({}))
    .addEdge(START, "extract")
    .addEdge("extract", "assess_coverage")
    .addEdge("assess_coverage", "review")
    .addEdge("review", END)
    .compile({ checkpointer, interruptBefore: ["review"] });
}

export type RunGraph = ReturnType<typeof buildRunGraph>;
