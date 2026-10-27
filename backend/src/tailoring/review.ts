import type { Change, Cv, ReviewDecision, UserEvidence } from "@resume-ai/shared";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { stage1Checks } from "@/tailoring/stage1Checks.js";

/** The Change with the user's version in place of the proposal: `revised`, with their `after` or `orderedItemIds`. */
function revise(change: Change, decision: ReviewDecision): Change {
  if (change.op === "remove") throw new Error("A remove cannot be revised");
  if (change.op === "reorder") return { ...change, status: "revised", orderedItemIds: decision.orderedItemIds ?? change.orderedItemIds };
  return { ...change, status: "revised", after: decision.after ?? change.after };
}

/**
 * The Changes with the decisions applied: each gets its final status, and a revised one carries the user's text or order.
 * Pure; a Change without a decision is left as it is (the service checks the decisions cover them all).
 */
export function applyDecisions(changes: Change[], decisions: ReviewDecision[]): Change[] {
  const byChange = new Map(decisions.map((d) => [d.changeId as string, d]));
  return changes.map((change) => {
    const decision = byChange.get(change.id);
    if (decision === undefined) return change;
    if (decision.decision === "revise") return revise(change, decision);
    return { ...change, status: decision.decision === "accept" ? "accepted" : "rejected" };
  });
}

/** The Changes the Tailored CV is built from: accepted and revised ones. */
export const keptChanges = (changes: Change[]): Change[] => changes.filter((c) => c.status === "accepted" || c.status === "revised");

/**
 * The first thing wrong with the decisions for these Changes, as a message that never echoes the user's text, or null
 * when they can be applied. Pure. Checks that they cover exactly the Changes (each once), that each revision fits its
 * Change's `op` and has content, that an accept or reject carries no text, and that a revised Change passes the stage-1
 * checks (a revised Change is trusted, so it is not claim-checked). `after` is expected trimmed by the caller.
 */
export function reviewProblem(original: Cv, changes: Change[], decisions: ReviewDecision[], userEvidence: UserEvidence[]): string | null {
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
    const { rejected } = stage1Checks(original, draft, [revise(change, decision)], userEvidence);
    if (rejected.length > 0) return `${label}: ${rejected[0]!.reason}`;
  }
  return null;
}
