import type { Change, Cv, ItemId, ReviewDecision, ReviewFit } from "@resume-ai/shared";
import { fitOf } from "@/export/fit.js";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { bulletParents, textItems } from "@/tailoring/cvItems.js";
import { applyDecisions, keptChanges, userDrops } from "@/tailoring/review.js";

/**
 * The shortest CV the user could submit: every `add` rejected, every `remove` accepted, a `replace` kept only when its text is
 * shorter than the original (the user can reject one that lengthens), and every job, project and
 * education entry cut to one bullet, its shortest as it reads after the Changes. An entry with no bullets stays without.
 * Pure.
 */
export function minimalCv(original: Cv, changes: Change[]): Cv {
  const originals = textItems(original);
  const shortens = (c: Change) => c.op === "replace" && c.after.length < (originals.get(c.targetItemId)?.text.length ?? 0);
  const cv = applyChanges(original, changes.filter((c) => c.op === "remove" || c.op === "reorder" || shortens(c)));
  for (const entry of bulletParents(cv)) {
    const shortest = entry.bullets.reduce<(typeof entry.bullets)[number] | undefined>((best, b) => (best === undefined || b.text.length < best.text.length ? b : best), undefined);
    entry.bullets = shortest === undefined ? [] : [shortest];
  }
  return cv;
}

/**
 * Does the CV built from `kept` fit one page? When it does, `fittable` is true without a second measure. When it does not,
 * `fittable` says whether the minimal CV of `changes` fits. Each measure renders up to 7 PDFs, so the minimal CV is only
 * measured when it is needed.
 */
export async function fitOfChanges(original: Cv, kept: Change[], changes: Change[]): Promise<ReviewFit> {
  const fit = await fitOf(applyChanges(original, kept));
  if (fit.fits) return { fits: true, step: fit.step, fittable: true };
  const floor = await fitOf(minimalCv(original, changes));
  return { fits: false, overByLines: fit.overByLines, fittable: floor.fits };
}

/**
 * The fit of a Review as submitted: the CV the graph would produce (the decisions applied, then the user's drops, kept
 * Changes only) measured with `fitOf`. `drops` are expected valid (`reviewProblem`).
 */
export function reviewFit(original: Cv, changes: Change[], decisions: ReviewDecision[], drops: ItemId[]): Promise<ReviewFit> {
  const kept = keptChanges([...applyDecisions(changes, decisions), ...userDrops(original, drops)]);
  return fitOfChanges(original, kept, changes);
}
