import type { Change, Coverage, Cv, Requirement, RequirementId, UserEvidence } from "@resume-ai/shared";
import { renderCv } from "@/prompts/renderCv.js";

/** A Change that an earlier round rejected, with the readable reason. */
export type TailorRejection = { round: number; change: Change; reason: string };

/** How the draft sits on the page: the size step it fits at (1-based, of `steps`), or the lines it is over at the smallest size. */
export type TailorFit = { fits: true; step: number; steps: number } | { fits: false; overByLines: number };

export type TailorInput = {
  /** The draft CV: the original plus the validated Changes so far. */
  cv: Cv;
  requirements: Requirement[];
  coverage: Coverage[];
  rejections: TailorRejection[];
  /** What the user said in the Answers. Their Requirements are targeted first. */
  userEvidence?: UserEvidence[];
  /** Requirements the user said they lack: left out of the prompt entirely. */
  confirmedGaps?: RequirementId[];
  /** The draft's fit, measured by the caller (`prompts/` never measures). Left out of the prompt when absent. */
  fit?: TailorFit;
};

const IMPORTANCE_LABEL = { must_have: "must-have", nice_to_have: "nice-to-have" } as const;

function renderChange(change: Change): string {
  switch (change.op) {
    case "replace":
      return `replace [${change.targetItemId}] with "${change.after}"`;
    case "remove":
      return `remove [${change.targetItemId}] (dropped to fit one page)`;
    case "add":
      return `add to [${change.parentId}] the text "${change.after}"`;
    case "reorder":
      return `reorder [${change.parentId}] as ${change.orderedItemIds.join(", ")}`;
  }
}

/**
 * The tailor's user message: the CV with IDs, the Requirements not met first (User Evidence first, then must-haves),
 * the met ones as context, then the User Evidence and earlier rejections with their reasons. Requirements with User
 * Evidence come first; Confirmed Gaps are left out. Pure.
 */
export function renderTailorInput({ cv, requirements: allRequirements, coverage, rejections, userEvidence = [], confirmedGaps = [], fit }: TailorInput): string {
  const requirements = allRequirements.filter((r) => !confirmedGaps.includes(r.id));
  const hasEvidence = new Set<string>(userEvidence.map((u) => u.requirementId));
  const verdictOf = new Map(coverage.map((c) => [c.requirementId as string, c]));
  const line = (r: Requirement) => {
    const c = verdictOf.get(r.id);
    const judged = c ? ` | ${c.verdict}: ${c.reason}` : "";
    return `[${r.id}] (${IMPORTANCE_LABEL[r.importance]}) ${r.text}${judged}`;
  };
  const isMet = (r: Requirement) => verdictOf.get(r.id)?.verdict === "met";
  const mustFirst = (a: Requirement, b: Requirement) =>
    Number(b.importance === "must_have") - Number(a.importance === "must_have");

  const evidenceFirst = (a: Requirement, b: Requirement) => Number(hasEvidence.has(b.id)) - Number(hasEvidence.has(a.id));

  const notMet = requirements.filter((r) => !isMet(r)).sort((a, b) => evidenceFirst(a, b) || mustFirst(a, b));
  const met = requirements.filter(isMet).sort(mustFirst);

  const parts = [
    `CV:\n${renderCv(cv)}`,
    `Requirements not met (target these: those with User Evidence first, then must-haves):\n${notMet.map(line).join("\n") || "(none)"}`,
    `Already met (context only, do not break these):\n${met.map(line).join("\n") || "(none)"}`,
  ];
  if (fit !== undefined) {
    const status = fit.fits
      ? `The draft fits one page at size step ${fit.step} of ${fit.steps}.`
      : `The draft is already over one page by ${fit.overByLines} ${fit.overByLines === 1 ? "line" : "lines"} at the smallest size.`;
    parts.push(`Page: the Tailored CV must fit one page, so prefer "replace" over "add" (rewording costs no space). ${status}`);
  }
  if (userEvidence.length > 0) {
    const lines = userEvidence.map((u) => `[${u.id}] (for ${u.requirementId}) ${u.text}`);
    parts.push(
      `User Evidence (the user's own statements about their experience; cite these IDs like CV Items, and add an Item from them under the job the statement names):\n${lines.join("\n")}`,
    );
  }
  if (rejections.length > 0) {
    const lines = rejections.map((x) => `- round ${x.round}: ${renderChange(x.change)}. Rejected because: ${x.reason}`);
    parts.push(`Rejected earlier (do not propose these again):\n${lines.join("\n")}`);
  }
  return parts.join("\n\n");
}
