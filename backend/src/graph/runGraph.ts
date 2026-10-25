import { END, START, StateGraph, type BaseCheckpointSaver } from "@langchain/langgraph";
import { extractCv } from "@/extraction/extractCv.js";
import { extractJobProfile } from "@/extraction/extractJobProfile.js";
import type { LlmClient } from "@/llm/llmClient.js";
import { tailorCv } from "@/tailoring/tailorCv.js";
import { validateChanges } from "@/tailoring/validateChanges.js";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { mergeRoundIntoChanges } from "@/tailoring/mergeChanges.js";
import { mergeCoverage, requirementsListedBy } from "@/tailoring/roundCoverage.js";
import { routeAfterRound, shouldSkipTailoring } from "@/scoring/exitRouter.js";
import { assessCoverage } from "@/scoring/assessCoverage.js";
import { matchScore } from "@/scoring/matchScore.js";
import { RunState } from "@/graph/state.js";
import type { RecordedRejection } from "@/tailoring/validateChanges.js";
import type { Change } from "@resume-ai/shared";

/** The Run status a node writes when the graph enters it (decisions record, "Storage and status"). */
export const NODE_STATUS = {
  extract: "extracting",
  assess_coverage: "extracting",
  begin_round: "tailoring",
  tailor: "tailoring",
  validate: "tailoring",
  rejudge: "tailoring",
  review: "awaiting_review",
} as const;

/** What one finished round did, for an observer such as the dev script. Plain data; the graph never reads it back. */
export type RoundSummary = {
  round: number;
  /** The tailor's output, before validation. */
  proposed: Change[];
  /** The Changes that passed stage 1 and the claim check. */
  valid: Change[];
  /** The Changes of this round that stage 1 or the claim check rejected. */
  rejections: RecordedRejection[];
  /** The score after re-judging this round, or null when it did not get that far. */
  roundScore: number | null;
  /** Whether the exit router kept the round. */
  kept: boolean;
  /** The kept score after the round (unrounded). */
  keptScore: number;
  failed: boolean;
};

export type RunGraphDeps = {
  /** Extraction. */
  llm: LlmClient;
  /** Judge-and-write work (Coverage now; the tailor and claim check later). */
  judgeLlm: LlmClient;
  checkpointer: BaseCheckpointSaver;
  /** Called first thing in each node, so the Run's status is written before the node's work starts. */
  onEnter: (runId: string, node: keyof typeof NODE_STATUS) => Promise<void>;
  /** Called by `route` once per round, after the decision. Optional; it must not throw. */
  onRound?: (summary: RoundSummary) => void;
};

/**
 * A failure inside a round is logged by error name and issue count only (messages and issues can quote CV text)
 * and handed to the exit router. The failing span already carries the error status (`withSpan`).
 */
function logRoundFailure(runId: string, round: number, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  const issues = (error as { issues?: unknown } | null)?.issues;
  const count = Array.isArray(issues) ? `, ${issues.length} issues` : "";
  console.error(`Run ${runId}: round ${round} failed: ${name}${count}`);
}

/**
 * The Run workflow (ADR 0001): extract, first Coverage, then either the pause before `review` (nothing to tailor)
 * or tailoring rounds: begin_round, tailor, validate, rejudge, route, and back to begin_round while the exit router
 * says so (at most MAX_ROUNDS). Nodes are thin: each calls functions from `extraction/`, `tailoring/` or `scoring/`
 * and returns a state update. `begin_round` counts the round as started; the `route` node is the only place that
 * commits the pending round.
 */
export function buildRunGraph({ llm, judgeLlm, checkpointer, onEnter, onRound }: RunGraphDeps) {
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
    .addNode("begin_round", async (state) => {
      await onEnter(state.runId, "begin_round");
      const round = state.rounds + 1;
      return { rounds: round, pending: { round, proposed: [], valid: [], coverage: null, score: null, failed: false } };
    })
    .addNode("tailor", async (state) => {
      await onEnter(state.runId, "tailor");
      const pending = state.pending!;
      const round = pending.round;
      try {
        const { changes } = await tailorCv(judgeLlm, {
          originalCv: state.cv!,
          draftCv: applyChanges(state.cv!, state.changes),
          requirements: state.jobProfile!.requirements,
          coverage: state.coverage!,
          rejections: state.rejections.map(({ round, change, reason }) => ({ round, change, reason })),
          round,
        });
        return { pending: { ...pending, proposed: changes } };
      } catch (error) {
        logRoundFailure(state.runId, round, error);
        return { pending: { ...pending, failed: true } };
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
        const tailored = applyChanges(state.cv!, mergeRoundIntoChanges(state.cv!, state.changes, pending.valid));
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
      // `null` means another round: the edge after `route` loops back while no exit reason is set.
      const exitReason = decision.next === "review" ? decision.exitReason : null;
      onRound?.({
        round: pending.round,
        proposed: pending.proposed,
        valid: pending.valid,
        rejections: state.rejections.filter((r) => r.round === pending.round),
        roundScore: pending.score,
        kept: decision.keepRound,
        keptScore: decision.keepRound ? pending.score! : previousScore,
        failed: pending.failed,
      });
      if (!decision.keepRound) return { pending: null, exitReason };
      return {
        pending: null,
        exitReason,
        changes: mergeRoundIntoChanges(state.cv!, state.changes, pending.valid),
        coverage: pending.coverage!,
        scoreAfter: pending.score!,
      };
    })
    // The candidate's turn. The graph stops before it; slice 6 resumes it.
    .addNode("review", () => ({}))
    .addEdge(START, "extract")
    .addEdge("extract", "assess_coverage")
    .addConditionalEdges("assess_coverage", (state) => (state.exitReason === null ? "begin_round" : "review"), ["begin_round", "review"])
    .addEdge("begin_round", "tailor")
    .addEdge("tailor", "validate")
    .addEdge("validate", "rejudge")
    .addEdge("rejudge", "route")
    .addConditionalEdges("route", (state) => (state.exitReason === null ? "begin_round" : "review"), ["begin_round", "review"])
    .addEdge("review", END)
    .compile({ checkpointer, interruptBefore: ["review"] });
}

export type RunGraph = ReturnType<typeof buildRunGraph>;
