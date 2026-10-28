import type { Coverage } from "@resume-ai/shared";

/** The previous verdicts with the re-judged ones swapped in; every other verdict carries over unchanged. */
export function mergeCoverage(previous: Coverage[], rejudged: Coverage[]): Coverage[] {
  const fresh = new Map(rejudged.map((c) => [c.requirementId as string, c]));
  return previous.map((c) => fresh.get(c.requirementId) ?? c);
}
