import type { Coverage, Requirement } from "@resume-ai/shared";
import { IMPORTANCE_WEIGHTS, VERDICT_CREDITS } from "@/scoring/weights.js";

/**
 * `100 × Σ(weight × credit) / Σ(weight)`, unrounded (the caller rounds for display).
 * A Requirement with no verdict counts as unmet.
 */
export function matchScore(requirements: Requirement[], coverage: Coverage[]): number {
  const verdictById = new Map(coverage.map((c) => [c.requirementId as string, c.verdict]));
  let earned = 0;
  let total = 0;
  for (const requirement of requirements) {
    const weight = IMPORTANCE_WEIGHTS[requirement.importance];
    const verdict = verdictById.get(requirement.id);
    earned += weight * (verdict === undefined ? 0 : VERDICT_CREDITS[verdict]);
    total += weight;
  }
  return (100 * earned) / total;
}
