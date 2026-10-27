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

/** The IDs of the Items the Changes rewrite or remove: the targets of their `replace` and `remove`. */
export function touchedItemIds(changes: Change[]): string[] {
  return changes.flatMap((c) => (c.op === "replace" || c.op === "remove" ? [c.targetItemId as string] : []));
}

/** The Requirements whose Coverage cites any of these Items as Evidence, in Job Profile order. */
export function requirementsCiting(requirements: Requirement[], coverage: Coverage[], itemIds: Iterable<string>): Requirement[] {
  const touched = new Set(itemIds);
  return requirements.filter((r) => coverage.some((c) => c.requirementId === r.id && c.evidenceIds.some((id) => touched.has(id))));
}

/**
 * The Requirements to judge again once Review is over, in Job Profile order. `undone` is the Changes the user rejected or
 * revised, their own drops included (a drop is a revised `remove`). A Requirement counts when one of them lists it, or when
 * its verdict cites an Item one of them rewrites or removes: that Evidence is not what the CV says any more.
 */
export function requirementsAffectedByReview(requirements: Requirement[], coverage: Coverage[], undone: Change[]): Requirement[] {
  const listed = new Set(requirementsListedBy(requirements, undone).map((r) => r.id as string));
  const cited = new Set(requirementsCiting(requirements, coverage, touchedItemIds(undone)).map((r) => r.id as string));
  return requirements.filter((r) => listed.has(r.id) || cited.has(r.id));
}
