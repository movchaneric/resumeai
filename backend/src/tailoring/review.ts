import { applyChanges, applyDecisions, dropProblem, reviseChange } from "@resume-ai/shared";
import type { Change, Cv, ItemId, ReviewDecision, UserEvidence } from "@resume-ai/shared";
import { stage1Checks } from "@/tailoring/stage1Checks.js";

/**
 * The first thing wrong with the decisions for these Changes, as a message that never echoes the user's text, or null
 * when they can be applied. Pure. Checks that they cover exactly the Changes (each once), that each revision fits its
 * Change's `op` and has content, that an accept or reject carries no text, and that a revised Change passes the stage-1
 * checks (a revised Change is trusted, so it is not claim-checked). `after` is expected trimmed by the caller. Then the
 * drops (`dropProblem`).
 */
export function reviewProblem(original: Cv, changes: Change[], decisions: ReviewDecision[], userEvidence: UserEvidence[], drops: ItemId[]): string | null {
  const known = new Set<string>(changes.map((c) => c.id));
  const seen = new Set<string>();
  for (const decision of decisions) {
    if (!known.has(decision.changeId)) return `Decision for ${decision.changeId}: this Run has no such Change.`;
    if (seen.has(decision.changeId)) return `Decision for ${decision.changeId} appears more than once.`;
    seen.add(decision.changeId);
  }
  const missing = changes.find((c) => !seen.has(c.id));
  if (missing) return `No decision for Change ${missing.id}; decide on every Change.`;

  const draft = applyChanges(original, changes);
  for (const decision of decisions) {
    const change = changes.find((c) => c.id === decision.changeId)!;
    const label = `Decision for ${change.id}`;
    if (decision.decision !== "revise") {
      if (decision.after !== undefined || decision.orderedItemIds !== undefined) return `${label}: only a revision carries \`after\` or \`orderedItemIds\`.`;
      continue;
    }
    if (change.op === "remove") return `${label}: a remove has no text to revise; accept or reject it.`;
    if (change.op === "reorder") {
      if (decision.after !== undefined) return `${label}: a reorder is revised with \`orderedItemIds\`, not \`after\`.`;
      if (decision.orderedItemIds === undefined) return `${label}: a revised reorder needs \`orderedItemIds\`.`;
    } else {
      if (decision.orderedItemIds !== undefined) return `${label}: a ${change.op} is revised with \`after\`, not \`orderedItemIds\`.`;
      if (decision.after === undefined || decision.after === "") return `${label}: a revised ${change.op} needs non-empty \`after\` text.`;
    }
    const { rejected } = stage1Checks(original, draft, [reviseChange(change, decision)], userEvidence);
    if (rejected.length > 0) return `${label}: ${rejected[0]!.reason}`;
  }
  return dropProblem(original, changes, applyDecisions(changes, decisions), drops);
}
