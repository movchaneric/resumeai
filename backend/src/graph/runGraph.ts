import { END, START, StateGraph, interrupt, type BaseCheckpointSaver } from "@langchain/langgraph";
import { extractCv } from "@/extraction/extractCv.js";
import type { LlmClient } from "@/llm/llmClient.js";
import { selectQuestions } from "@/tailoring/questions.js";
import { tailorCv } from "@/tailoring/tailorCv.js";
import { validateChanges } from "@/tailoring/validateChanges.js";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { mergeRoundIntoChanges } from "@/tailoring/mergeChanges.js";
import { mergeCoverage, requirementsListedBy } from "@/tailoring/roundCoverage.js";
import { routeAfterRound, shouldSkipTailoring } from "@/scoring/exitRouter.js";
import { assessCoverage } from "@/scoring/assessCoverage.js";
import { matchScore } from "@/scoring/matchScore.js";
import { resolveJobProfile, type JobProfileCache } from "@/graph/jobProfileCache.js";
import { RunState } from "@/graph/state.js";
import type { RecordedRejection } from "@/tailoring/validateChanges.js";
import { UserEvidenceIdSchema, type Answer, type Change, type Question, type RequirementId, type UserEvidence } from "@resume-ai/shared";

/** The Run status a node writes when the graph enters it (decisions record, "Storage and status"). */
export const NODE_STATUS = {
  extract: "extracting",
  assess_coverage: "extracting",
  collect_answers: "awaiting_answers",
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
  /** CV extraction (`LLM_MODEL`). The Job Profile is extracted with `judgeLlm`, so its Requirement list is stable. */
  llm: LlmClient;
  /** Judge-and-write work (Coverage, the tailor and the claim check). */
  judgeLlm: LlmClient;
  /** The judge model's name; part of the Job Profile cache key. */
  judgeModel: string;
  /** Job Profiles shared across Runs (ADR 0007). A failing cache never fails a Run. */
  jobProfileCache: JobProfileCache;
  checkpointer: BaseCheckpointSaver;
  /** Called first thing in each node, so the Run's status is written before the node's work starts. */
  onEnter: (runId: string, node: keyof typeof NODE_STATUS) => Promise<void>;
  /** Called by `route` once per round, after the decision. Optional; it must not throw. */
  onRound?: (summary: RoundSummary) => void;
};

/**
 * What the Answers record. A `has_experience` Answer becomes User Evidence (`ue1`, `ue2`, ... in Question order), a
 * `no_experience` Answer makes its Requirement a Confirmed Gap, and a Question without an Answer records nothing.
 */
function recordAnswers(questions: Question[], answers: Answer[]): { userEvidence: UserEvidence[]; confirmedGaps: RequirementId[] } {
  const userEvidence: UserEvidence[] = [];
  const confirmedGaps: RequirementId[] = [];
  for (const question of questions) {
    const given = answers.find((a) => a.questionId === question.id);
    if (given?.kind === "has_experience") {
      userEvidence.push({
        id: UserEvidenceIdSchema.parse(`ue${userEvidence.length + 1}`),
        questionId: question.id,
        requirementId: question.requirementId,
        text: given.text,
      });
    } else if (given?.kind === "no_experience") {
      confirmedGaps.push(question.requirementId);
    }
  }
  return { userEvidence, confirmedGaps };
}

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
 * or `select_questions` (which pauses in `collect_answers` for the user's Answers when there is anything to ask) and then
 * tailoring rounds: begin_round, tailor, validate, rejudge, route, and back to begin_round while the exit router
 * says so (at most MAX_ROUNDS). Nodes are thin: each calls functions from `extraction/`, `tailoring/` or `scoring/`
 * and returns a state update. `begin_round` counts the round as started; the `route` node is the only place that
 * commits the pending round.
 */
export function buildRunGraph({ llm, judgeLlm, judgeModel, jobProfileCache, checkpointer, onEnter, onRound }: RunGraphDeps) {
  return new StateGraph(RunState)
    .addNode("extract", async (state) => {
      await onEnter(state.runId, "extract");
      const jobProfile = await resolveJobProfile({ cache: jobProfileCache, judgeLlm, judgeModel }, state.jobDescriptionText);
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
    // Computes the Questions and stores them, so the Run view can show them while the graph is paused.
    // (Named for what it does: LangGraph forbids a node with the same name as the `questions` state channel.)
    .addNode("select_questions", (state) => ({ questions: selectQuestions(state.jobProfile!.requirements, state.coverage!) }))
    // The only `interrupt()`. LangGraph runs this node again from the top on resume, so everything before the
    // `interrupt()` call must be pure: here it is only a read of `state.questions`.
    .addNode("collect_answers", (state) => {
      const answers = interrupt<Question[], Answer[]>(state.questions);
      return recordAnswers(state.questions, answers);
    })
    .addNode("begin_round", async (state) => {
      const round = state.rounds + 1;
      const pending = { round, proposed: [], valid: [], coverage: null, score: null, failed: false };
      // A failing status write fails the round like any other step; it never rejects the graph.
      try {
        await onEnter(state.runId, "begin_round");
      } catch (error) {
        logRoundFailure(state.runId, round, error);
        return { rounds: round, pending: { ...pending, failed: true } };
      }
      return { rounds: round, pending };
    })
    .addNode("tailor", async (state) => {
      const pending = state.pending!;
      const round = pending.round;
      if (pending.failed) return {};
      try {
        await onEnter(state.runId, "tailor");
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
      const pending = state.pending!;
      if (pending.failed) return {};
      try {
        await onEnter(state.runId, "validate");
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
      const pending = state.pending!;
      if (pending.failed) return {};
      const { requirements } = state.jobProfile!;
      try {
        await onEnter(state.runId, "rejudge");
        if (pending.valid.length === 0) return {};
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
        consecutiveEmptyRounds: state.consecutiveEmptyRounds,
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
      const consecutiveEmptyRounds = !pending.failed && pending.valid.length === 0 ? state.consecutiveEmptyRounds + 1 : 0;
      if (!decision.keepRound) return { pending: null, exitReason, consecutiveEmptyRounds };
      return {
        pending: null,
        exitReason,
        consecutiveEmptyRounds,
        changes: mergeRoundIntoChanges(state.cv!, state.changes, pending.valid),
        coverage: pending.coverage!,
        scoreAfter: pending.score!,
      };
    })
    // The candidate's turn. The graph stops before it; slice 6 resumes it.
    .addNode("review", () => ({}))
    .addEdge(START, "extract")
    .addEdge("extract", "assess_coverage")
    .addConditionalEdges("assess_coverage", (state) => (state.exitReason === null ? "select_questions" : "review"), ["select_questions", "review"])
    .addConditionalEdges("select_questions", (state) => (state.questions.length === 0 ? "begin_round" : "collect_answers"), ["begin_round", "collect_answers"])
    .addEdge("collect_answers", "begin_round")
    .addEdge("begin_round", "tailor")
    .addEdge("tailor", "validate")
    .addEdge("validate", "rejudge")
    .addEdge("rejudge", "route")
    .addConditionalEdges("route", (state) => (state.exitReason === null ? "begin_round" : "review"), ["begin_round", "review"])
    .addEdge("review", END)
    .compile({ checkpointer, interruptBefore: ["review"] });
}

export type RunGraph = ReturnType<typeof buildRunGraph>;
