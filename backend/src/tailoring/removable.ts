import type { Change, Coverage, Cv } from "@resume-ai/shared";
import { applyChanges, bulletParents, originalBulletIds } from "@resume-ai/shared";

/** The IDs cited as Evidence by a Coverage whose verdict is `met` or `partially_met`: removing one would weaken a covered Requirement. */
export function citedByCoverage(coverage: Coverage[]): Set<string> {
  return new Set(coverage.filter((c) => c.verdict !== "unmet").flatMap((c) => c.evidenceIds));
}

/**
 * The bullet Item IDs the model may drop to fit one page. `cv` is the original CV, `changes` the Changes kept so far
 * (their removes, adds and replaces are applied first). A bullet qualifies when all of these hold:
 * - it is a bullet of a job, project or education entry, and it is in the original CV (never an Item a tailor `add` created);
 * - it is not already removed by `changes`;
 * - no Coverage with the verdict `met` or `partially_met` cites it as Evidence;
 * - it is not the last bullet of its parent. A parent with N bullets left (original ones not removed; an added bullet never counts as staying) lists at most N - 1: one with a
 *   single bullet left lists none, and when every one of N bullets qualifies the first is left out so that it stays.
 * The list is a menu for one batch; stage 1 re-checks the removes one by one, so a batch can never empty a parent.
 */
export function removableBullets(cv: Cv, coverage: Coverage[], changes: Change[]): Set<string> {
  const draft = applyChanges(cv, changes);
  const cited = citedByCoverage(coverage);
  const originalIds = originalBulletIds(cv);
  const result = new Set<string>();
  for (const parent of bulletParents(draft)) {
    const left = parent.bullets.map((b) => b.id).filter((id) => originalIds.has(id));
    if (left.length <= 1) continue;
    const eligible = left.filter((id) => !cited.has(id));
    if (eligible.length === left.length) eligible.shift();
    for (const id of eligible) result.add(id);
  }
  return result;
}
