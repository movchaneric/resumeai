import type { Change, Coverage, Requirement } from "@resume-ai/shared";

/** The Requirements the valid Changes list, in Job Profile order. Only these are judged again after a round. */
export function requirementsListedBy(requirements: Requirement[], changes: Change[]): Requirement[] {
  const listed = new Set(changes.flatMap((c) => c.requirementIds as string[]));
  return requirements.filter((r) => listed.has(r.id));
}

/** The previous verdicts with the re-judged ones swapped in; every other verdict carries over unchanged. */
export function mergeCoverage(previous: Coverage[], rejudged: Coverage[]): Coverage[] {
  const fresh = new Map(rejudged.map((c) => [c.requirementId as string, c]));
  return previous.map((c) => fresh.get(c.requirementId) ?? c);
}
