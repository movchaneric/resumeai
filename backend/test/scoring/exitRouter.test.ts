import { describe, expect, it } from "vitest";
import type { CoverageVerdict } from "@resume-ai/shared";
import {
  MAX_ROUNDS,
  MIN_GAIN,
  TARGET_SCORE,
  routeAfterRound,
  shouldSkipTailoring,
  type RoundOutcome,
} from "@/scoring/exitRouter.js";

const ok = (validChanges: number, newScore: number): RoundOutcome => ({ failed: false, validChanges, newScore });

describe("exit constants", () => {
  it("are 90 points, 2 points of gain and 3 rounds", () => {
    expect(TARGET_SCORE).toBe(90);
    expect(MIN_GAIN).toBe(2);
    expect(MAX_ROUNDS).toBe(3);
  });
});

describe("routeAfterRound", () => {
  it("continues and keeps the round when nothing stops it", () => {
    expect(routeAfterRound({ previousScore: 50, round: 1, outcome: ok(2, 60) })).toEqual({
      next: "another_round",
      keepRound: true,
    });
  });

  it("discards a failed round and exits with error", () => {
    expect(routeAfterRound({ previousScore: 50, round: 1, outcome: { failed: true } })).toEqual({
      next: "review",
      exitReason: "error",
      keepRound: false,
    });
  });

  it("exits with ceiling when no valid Changes, keeping nothing", () => {
    expect(routeAfterRound({ previousScore: 50, round: 1, outcome: ok(0, 50) })).toEqual({
      next: "review",
      exitReason: "ceiling",
      keepRound: false,
    });
  });

  it("discards a round that lowers the score and exits with plateau", () => {
    expect(routeAfterRound({ previousScore: 50, round: 1, outcome: ok(1, 49.5) })).toEqual({
      next: "review",
      exitReason: "plateau",
      keepRound: false,
    });
  });

  it("keeps the round and exits with target_reached at 90 or more", () => {
    expect(routeAfterRound({ previousScore: 80, round: 1, outcome: ok(1, 90) })).toEqual({
      next: "review",
      exitReason: "target_reached",
      keepRound: true,
    });
  });

  it("keeps the round and exits with plateau when the gain is below 2", () => {
    expect(routeAfterRound({ previousScore: 50, round: 1, outcome: ok(1, 51.99) })).toEqual({
      next: "review",
      exitReason: "plateau",
      keepRound: true,
    });
  });

  it("continues when the gain is exactly 2", () => {
    expect(routeAfterRound({ previousScore: 50, round: 1, outcome: ok(1, 52) })).toEqual({
      next: "another_round",
      keepRound: true,
    });
  });

  it("keeps a zero-gain round as plateau (not discarded)", () => {
    expect(routeAfterRound({ previousScore: 50, round: 1, outcome: ok(1, 50) })).toMatchObject({
      exitReason: "plateau",
      keepRound: true,
    });
  });

  it("exits with max_iterations after the third round, keeping it", () => {
    expect(routeAfterRound({ previousScore: 50, round: 3, outcome: ok(1, 60) })).toEqual({
      next: "review",
      exitReason: "max_iterations",
      keepRound: true,
    });
  });

  describe("order of the rules", () => {
    it("failure beats everything", () => {
      expect(routeAfterRound({ previousScore: 50, round: 3, outcome: { failed: true } })).toMatchObject({
        exitReason: "error",
      });
    });
    it("ceiling beats a lower or high score", () => {
      expect(routeAfterRound({ previousScore: 50, round: 1, outcome: ok(0, 95) })).toMatchObject({
        exitReason: "ceiling",
      });
    });
    it("a lower score beats target_reached", () => {
      expect(routeAfterRound({ previousScore: 95, round: 1, outcome: ok(1, 92) })).toMatchObject({
        exitReason: "plateau",
        keepRound: false,
      });
    });
    it("target_reached beats a small gain", () => {
      expect(routeAfterRound({ previousScore: 89, round: 1, outcome: ok(1, 90) })).toMatchObject({
        exitReason: "target_reached",
      });
    });
    it("a small gain beats max_iterations", () => {
      expect(routeAfterRound({ previousScore: 50, round: 3, outcome: ok(1, 51) })).toMatchObject({
        exitReason: "plateau",
      });
    });
  });
});

describe("shouldSkipTailoring", () => {
  const all = (v: CoverageVerdict, n = 3) => Array<CoverageVerdict>(n).fill(v);

  it("skips when every Requirement is met", () => {
    expect(shouldSkipTailoring({ score: 97.5, verdicts: all("met") })).toBe(true);
  });
  it("skips when the score is 100", () => {
    expect(shouldSkipTailoring({ score: 100, verdicts: ["met", "partially_met"] })).toBe(true);
  });
  it("does not skip otherwise", () => {
    expect(shouldSkipTailoring({ score: 99.9, verdicts: ["met", "partially_met"] })).toBe(false);
  });
  it("does not skip when there are no Requirements", () => {
    expect(shouldSkipTailoring({ score: 0, verdicts: [] })).toBe(false);
  });
});
