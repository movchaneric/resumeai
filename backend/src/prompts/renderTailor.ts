import type { Change, Coverage, Cv, Requirement } from "@resume-ai/shared";
import { renderCv } from "@/prompts/renderCv.js";

/** A Change that an earlier round rejected, with the readable reason. */
export type TailorRejection = { round: number; change: Change; reason: string };

export type TailorInput = {
  /** The draft CV: the original plus the validated Changes so far. */
  cv: Cv;
  requirements: Requirement[];
  coverage: Coverage[];
  rejections: TailorRejection[];
};

const IMPORTANCE_LABEL = { must_have: "must-have", nice_to_have: "nice-to-have" } as const;

function renderChange(change: Change): string {
  switch (change.op) {
    case "replace":
      return `replace [${change.targetItemId}] with "${change.after}"`;
    case "add":
      return `add to [${change.parentId}] the text "${change.after}"`;
    case "reorder":
      return `reorder [${change.parentId}] as ${change.orderedItemIds.join(", ")}`;
  }
}

/**
 * The tailor's user message: the CV with IDs, the Requirements not met first (must-haves first),
 * the met ones as context, then earlier rejections with their reasons. Pure.
 */
export function renderTailorInput({ cv, requirements, coverage, rejections }: TailorInput): string {
  const verdictOf = new Map(coverage.map((c) => [c.requirementId as string, c]));
  const line = (r: Requirement) => {
    const c = verdictOf.get(r.id);
    const judged = c ? ` | ${c.verdict}: ${c.reason}` : "";
    return `[${r.id}] (${IMPORTANCE_LABEL[r.importance]}) ${r.text}${judged}`;
  };
  const isMet = (r: Requirement) => verdictOf.get(r.id)?.verdict === "met";
  const mustFirst = (a: Requirement, b: Requirement) =>
    Number(b.importance === "must_have") - Number(a.importance === "must_have");

  const notMet = requirements.filter((r) => !isMet(r)).sort(mustFirst);
  const met = requirements.filter(isMet).sort(mustFirst);

  const parts = [
    `CV:\n${renderCv(cv)}`,
    `Requirements not met (target these, must-haves first):\n${notMet.map(line).join("\n") || "(none)"}`,
    `Already met (context only, do not break these):\n${met.map(line).join("\n") || "(none)"}`,
  ];
  if (rejections.length > 0) {
    const lines = rejections.map((x) => `- round ${x.round}: ${renderChange(x.change)}. Rejected because: ${x.reason}`);
    parts.push(`Rejected earlier (do not propose these again):\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}
