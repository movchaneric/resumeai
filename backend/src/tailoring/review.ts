import { ChangeSchema } from "@resume-ai/shared";
import type { Change, Cv, ItemId, ReviewDecision, UserEvidence } from "@resume-ai/shared";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { textItems } from "@/tailoring/cvItems.js";
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

/**
 * The Changes for the bullets the user drops at Review: a `remove` each, already `revised` (their own call, so trusted and
 * never claim-checked), with the bullet's original text in `before` and IDs `ud.c1`, `ud.c2`, ... in the order given.
 * Pure. Pass only drops that `reviewProblem` accepted.
 */
export function userDrops(original: Cv, drops: ItemId[]): Change[] {
  const texts = textItems(original);
  return drops.map((targetItemId, i) =>
    ChangeSchema.parse({
      id: `ud.c${i + 1}`,
      op: "remove",
      targetItemId,
      before: texts.get(targetItemId)?.text ?? "",
      evidenceIds: [],
      requirementIds: [],
      rationale: "Dropped by you in Review.",
      status: "revised",
    }),
  );
}

/** The jobs, projects and education entries: the only parents whose bullets can be dropped. */
const bulletParents = (cv: Cv) => [...cv.experience, ...cv.projects, ...cv.education];

/** The Changes the Tailored CV is built from: accepted and revised ones. */
export const keptChanges = (changes: Change[]): Change[] => changes.filter((c) => c.status === "accepted" || c.status === "revised");

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
    const { rejected } = stage1Checks(original, draft, [revise(change, decision)], userEvidence);
    if (rejected.length > 0) return `${label}: ${rejected[0]!.reason}`;
  }
  return dropProblem(original, changes, applyDecisions(changes, decisions), drops);
}

/**
 * The first thing wrong with the drops, as a message naming the Item, or null. `decided` is the Changes with the decisions
 * applied. A drop must be a bullet of a job, project or education entry in the ORIGINAL CV, once; it can be a bullet a
 * condensing Change already removes only if the user rejected that Change; a bullet with a `replace` needs that
 * Change rejected (one kept Change per Item); and in the CV the decisions and drops produce, every entry that had bullets keeps
 * one. A cited bullet may be dropped: the never-drop-cited rule binds the model, not the user.
 */
function dropProblem(original: Cv, changes: Change[], decided: Change[], drops: ItemId[]): string | null {
  if (drops.length === 0) return null;
  const idsOf = (cv: Cv) => new Set(bulletParents(cv).flatMap((p) => p.bullets.map((b) => b.id as string)));
  const originalBullets = idsOf(original);
  const withAdds = idsOf(applyChanges(original, changes));
  const seen = new Set<string>();
  for (const id of drops) {
    if (seen.has(id)) return `Drop ${id} appears more than once.`;
    seen.add(id);
    if (!originalBullets.has(id)) {
      return withAdds.has(id)
        ? `Drop ${id}: the tailor added this bullet; reject its Change instead.`
        : `Drop ${id}: not a bullet of a job, project or education entry in your CV.`;
    }
    const removing = decided.find((c) => c.op === "remove" && c.targetItemId === id && c.status === "accepted");
    if (removing) return `Drop ${id}: Change ${removing.id} already removes it.`;
    const rewriting = decided.find((c) => c.op === "replace" && c.targetItemId === id && c.status !== "rejected");
    if (rewriting) return `Drop ${id}: reject its Change ${rewriting.id} to drop it.`;
  }

  const result = applyChanges(original, keptChanges([...decided, ...userDrops(original, drops)]));
  const left = new Map(bulletParents(result).map((p) => [p.id as string, p.bullets.length]));
  for (const parent of bulletParents(original)) {
    const dropped = parent.bullets.find((b) => seen.has(b.id));
    if (dropped && left.get(parent.id) === 0) return `Drop ${dropped.id}: ${parent.id} would be left with no bullet; keep at least one.`;
  }
  return null;
}
