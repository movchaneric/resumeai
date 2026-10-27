import type { Cv } from "@resume-ai/shared";
import { measureFit } from "@/export/measureFit.js";

/** About how many points of height one line of body text takes; `overByLines` counts in these. */
export const POINTS_PER_LINE = 14;

/** What Condensing needs to know: does the CV fit one page (and at which size step), or how many lines it is over at the smallest size. */
export type FitResult = { fits: true; step: number } | { fits: false; overByLines: number };

/** `measureFit` boiled down: the step on a fit, or the overflow rounded up to whole lines. */
export async function fitOf(cv: Cv): Promise<FitResult> {
  const fit = await measureFit(cv);
  return fit.fits ? { fits: true, step: fit.step } : { fits: false, overByLines: Math.ceil(fit.overBy / POINTS_PER_LINE) };
}
