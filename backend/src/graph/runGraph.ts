import { END, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import { extractCv } from "@/extraction/extractCv.js";
import { extractJobProfile } from "@/extraction/extractJobProfile.js";
import type { LlmClient } from "@/llm/llmClient.js";
import { tailorCv } from "@/tailoring/tailorCv.js";
import { validateChanges } from "@/tailoring/validateChanges.js";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { mergeCoverage, requirementsListedBy } from "@/tailoring/roundCoverage.js";
import { routeAfterRound, shouldSkipTailoring } from "@/scoring/exitRouter.js";
import { assessCoverage } from "@/scoring/assessCoverage.js";
import { matchScore } from "@/scoring/matchScore.js";
import { RunState } from "@/graph/state.js";

/** The Run status a node writes when the graph enters it (decisions record, "Storage and status"). */
export const NODE_STATUS = {
  extract: "extracting",
  assess_coverage: "extracting",
  tailor: "tailoring",
  validate: "tailoring",
  rejudge: "tailoring",
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

/** A failure inside a round is logged by name only (messages can quote CV text) and handed to the exit router. */
function logRoundFailure(runId: string, round: number, error: unknown): void {
  console.error(`Run ${runId}: round ${round} failed: ${error instanceof Error ? error.name : typeof error}`);
}

/**
 * The Run workflow (ADR 0001): extract, first Coverage, then either the pause before `review` (nothing to tailor)
 * or a tailoring round: tailor, validate, rejudge, route. Nodes are thin: each calls functions from `extraction/`,
 * `tailoring/` or `scoring/` and returns a state update. The `route` node is the only place that commits the
 * pending round. A later ticket turns its exit into a loop back to `tailor`.
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
      const requirements = state.jobProfile!.requirements;
      const { coverage } = await assessCoverage(judgeLlm, state.cv!, requirements, { round: 0 });
      const score = matchScore(requirements, coverage);
      const base = { coverageBefore: coverage, coverage, scoreBefore: score, scoreAfter: score };
      // Nothing to gain: skip tailoring and go straight to review.
      if (shouldSkipTailoring({ score, verdicts: coverage.map((c) => c.verdict) })) {
        return { ...base, exitReason: "target_reached" as const };
      }
      return base;
    })
    .addNode("tailor", async (state) => {
      await onEnter(state.runId, "tailor");
      const round = state.rounds + 1;
      const pending = { round, proposed: [], valid: [], coverage: null, score: null, failed: false };
      try {
        const { changes } = await tailorCv(judgeLlm, {
          originalCv: state.cv!,
          draftCv: applyChanges(state.cv!, state.changes),
          requirements: state.jobProfile!.requirements,
          coverage: state.coverage!,
          rejections: state.rejections.map(({ round, change, reason }) => ({ round, change, reason })),
          round,
        });
        return { rounds: round, pending: { ...pending, proposed: changes } };
      } catch (error) {
        logRoundFailure(state.runId, round, error);
        return { rounds: round, pending: { ...pending, failed: true } };
      }
    })
    .addNode("validate", async (state) => {
      await onEnter(state.runId, "validate");
      const pending = state.pending!;
      if (pending.failed) return {};
      try {
        const { valid, rejections } = await validateChanges(judgeLlm, {
          original: state.cv!,
          draft: applyChanges(state.cv!, state.changes),
          changes: pending.proposed,
          round: pending.round,
        });
        return { pending: { ...pending, valid }, rejections: [...state.rejections, ...rejections] };
      } catch (error) {
        logRoundFailure(state.runId, pending.round, error);
        return { pending: { ...pending, failed: true } };
      }
    })
    .addNode("rejudge", async (state) => {
      await onEnter(state.runId, "rejudge");
      const pending = state.pending!;
      if (pending.failed || pending.valid.length === 0) return {};
      const { requirements } = state.jobProfile!;
      try {
        // Only the Requirements the valid Changes list; the other verdicts carry over.
        const tailored = applyChanges(state.cv!, [...state.changes, ...pending.valid]);
        const { coverage } = await assessCoverage(judgeLlm, tailored, requirementsListedBy(requirements, pending.valid), {
          round: pending.round,
        });
        const merged = mergeCoverage(state.coverage!, coverage);
        return { pending: { ...pending, coverage: merged, score: matchScore(requirements, merged) } };
      } catch (error) {
        logRoundFailure(state.runId, pending.round, error);
        return { pending: { ...pending, failed: true } };
      }
    })
    .addNode("route", (state) => {
      const pending = state.pending!;
      const previousScore = state.scoreAfter ?? state.scoreBefore!;
      const decision = routeAfterRound({
        previousScore,
        round: pending.round,
        outcome: pending.failed
          ? { failed: true }
          : { failed: false, validChanges: pending.valid.length, newScore: pending.score ?? previousScore },
      });
      // One round only for now: where the router would continue, stop with the round cap.
      const exitReason = decision.next === "review" ? decision.exitReason : ("max_iterations" as const);
      if (!decision.keepRound) return { pending: null, exitReason };
      return {
        pending: null,
        exitReason,
        changes: [...state.changes, ...pending.valid],
        coverage: pending.coverage!,
        scoreAfter: pending.score!,
      };
    })
    // The candidate's turn. The graph stops before it; slice 6 resumes it.
    .addNode("review", () => ({}))
    .addEdge(START, "extract")
    .addEdge("extract", "assess_coverage")
    .addConditionalEdges("assess_coverage", (state) => (state.exitReason === null ? "tailor" : "review"), ["tailor", "review"])
    .addEdge("tailor", "validate")
    .addEdge("validate", "rejudge")
    .addEdge("rejudge", "route")
    .addEdge("route", "review")
    .addEdge("review", END)
    .compile({ checkpointer, interruptBefore: ["review"] });
}

export type RunGraph = ReturnType<typeof buildRunGraph>;
