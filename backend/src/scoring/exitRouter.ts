import type { CoverageVerdict, ExitReason } from "@resume-ai/shared";

/* Exit router constants (slice 4a decisions). They live here, not in .env. */
export const TARGET_SCORE = 90;
/** Smallest gain, in points on unrounded scores, that justifies another round. */
export const MIN_GAIN = 2;
export const MAX_ROUNDS = 3;

/** What the pending round produced: it failed, or it has a count of valid Changes and a new unrounded score. */
export type RoundOutcome = { failed: true } | { failed: false; validChanges: number; newScore: number };

export interface RouteInput {
  /** Unrounded score of the last kept round (or before tailoring). */
  previousScore: number;
  /** Number of the round that just finished, starting at 1. */
  round: number;
  outcome: RoundOutcome;
  /** Rounds with no valid Changes immediately before this one (0 when the previous round had some, or this is round 1). */
  consecutiveEmptyRounds: number;
}

export type RouteDecision =
  | { next: "another_round"; keepRound: boolean }
  | { next: "review"; exitReason: ExitReason; keepRound: boolean };

const stop = (exitReason: ExitReason, keepRound: boolean): RouteDecision => ({ next: "review", exitReason, keepRound });

/** Decides after each round whether to loop or stop for review, and whether the pending round is kept. */
export function routeAfterRound({ previousScore, round, outcome, consecutiveEmptyRounds }: RouteInput): RouteDecision {
  if (outcome.failed) return stop("error", false);
  if (outcome.validChanges === 0) {
    // An empty round is never kept. It gets one second chance (its tailor sees the rejections), within the round cap.
    if (consecutiveEmptyRounds >= 1) return stop("ceiling", false);
    if (round >= MAX_ROUNDS) return stop("max_iterations", false);
    return { next: "another_round", keepRound: false };
  }
  if (outcome.newScore < previousScore) return stop("plateau", false);
  if (outcome.newScore >= TARGET_SCORE) return stop("target_reached", true);
  if (outcome.newScore - previousScore < MIN_GAIN) return stop("plateau", true);
  if (round >= MAX_ROUNDS) return stop("max_iterations", true);
  return { next: "another_round", keepRound: true };
}

/** Before round 1: tailoring is pointless when every Requirement is met or the score is already 100. */
export function shouldSkipTailoring(input: { score: number; verdicts: CoverageVerdict[] }): boolean {
  if (input.score >= 100) return true;
  return input.verdicts.length > 0 && input.verdicts.every((v) => v === "met");
}
