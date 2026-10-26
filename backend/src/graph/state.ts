import { Annotation } from "@langchain/langgraph";
import type { RecordedRejection } from "@/tailoring/validateChanges.js";
import type { Change, Coverage, Cv, ExitReason, JobProfile, Question, RequirementId, UserEvidence } from "@resume-ai/shared";

/** A channel that keeps the last value written. `default` is what a node sees before anything wrote to it. */
const last = <T>(initial: T) => Annotation<T>({ reducer: (_current, update) => update, default: () => initial });

/** The round in progress. Nothing here reaches `changes`, `coverage` or the scores until the exit router keeps the round. */
export type PendingRound = {
  /** 1-based. */
  round: number;
  /** The tailor's output, before validation. */
  proposed: Change[];
  /** The Changes that passed stage 1 and the claim check. */
  valid: Change[];
  /** The merged verdicts after re-judging, and their score. Null until the re-judge has run. */
  coverage: Coverage[] | null;
  score: number | null;
  /** A step of the round threw; the router ends the Run with `error`. */
  failed: boolean;
};

/**
 * The graph state is the only store for Run data (ADR 0003). The tailoring round's working data sits in `pending` until the exit router commits it.
 */
export const RunState = Annotation.Root({
  /** Inputs, passed by the service when the graph starts. */
  runId: last(""),
  cvText: last(""),
  jobDescriptionText: last(""),
  /** Extraction. */
  jobProfile: last<JobProfile | null>(null),
  cv: last<Cv | null>(null),
  /** Coverage from the first call, never changed afterwards, and the verdicts of the last kept round. */
  coverageBefore: last<Coverage[] | null>(null),
  coverage: last<Coverage[] | null>(null),
  /** The Questions asked once after the first Coverage, what the user said in the Answers, and the Requirements they said they lack. */
  questions: last<Question[]>([]),
  userEvidence: last<UserEvidence[]>([]),
  confirmedGaps: last<RequirementId[]>([]),
  /** The current set of validated Changes (empty until tailoring exists). */
  changes: last<Change[]>([]),
  /** Unrounded Match Scores: before tailoring, and after the last kept round. */
  scoreBefore: last<number | null>(null),
  scoreAfter: last<number | null>(null),
  /** Every Change that stage 1 or the claim check rejected, across rounds (kept or not). */
  rejections: last<RecordedRejection[]>([]),
  /** The round in progress, or null between rounds. */
  pending: last<PendingRound | null>(null),
  /** Tailoring rounds started. */
  rounds: last(0),
  /** Rounds in a row, up to the last one finished, that had no valid Changes. */
  consecutiveEmptyRounds: last(0),
  exitReason: last<ExitReason | null>(null),
});

export type RunStateValues = typeof RunState.State;
