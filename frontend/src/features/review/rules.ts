import { applyDecisions, dropProblem, requirementsAffectedByReview, userDrops } from "@resume-ai/shared";
import type { Change, Coverage, ItemId, ReviewSubmission } from "@resume-ai/shared";
import type { ReviewRun, ReviewState } from "@/features/review/types";

/** The submission for the state: a decision per Change in the Run's order, and the drops. Pure; `after` is trimmed as the server does. */
export function toSubmission(state: Pick<ReviewState, "changeIds" | "decisions" | "drops">): ReviewSubmission {
  return {
    decisions: state.changeIds.map((id) => {
      const d = state.decisions[id] ?? { decision: "accept" as const };
      const out: ReviewSubmission["decisions"][number] = { changeId: id as ReviewSubmission["decisions"][number]["changeId"], decision: d.decision };
      if (d.decision === "revise") {
        if (d.after !== undefined) out.after = d.after;
        if (d.orderedItemIds !== undefined) out.orderedItemIds = d.orderedItemIds;
      }
      return out;
    }),
    drops: [...state.drops],
  };
}

/** The Run's Changes with the state's decisions applied (the `decided` argument of the shared `dropProblem`). */
export function decidedChanges(run: Pick<ReviewRun, "changes">, state: Pick<ReviewState, "changeIds" | "decisions" | "drops">): Change[] {
  return applyDecisions(run.changes, toSubmission(state).decisions);
}

/** The first thing wrong with the drops for these decisions (the shared rule, as the server applies it), or null. */
export function dropsProblem(run: ReviewRun, state: Pick<ReviewState, "changeIds" | "decisions" | "drops">, drops: ItemId[]): string | null {
  return dropProblem(run.originalCv, run.changes, decidedChanges(run, state), drops);
}

export type CanDrop = { ok: true } | { ok: false; reason: string };

/**
 * Whether this bullet can be dropped on top of the current decisions and drops. Uses the shared `dropProblem`, as the
 * server's `reviewProblem` does; `reason` is that rule's message, which names the Item.
 */
export function canDrop(run: ReviewRun, state: ReviewState, itemId: ItemId): CanDrop {
  const reason = dropsProblem(run, state, [...state.drops, itemId]);
  return reason === null ? { ok: true } : { ok: false, reason };
}

/** The Requirements whose final verdict cites this Item as Evidence (for the "may lower the score" confirm before a drop). */
export function citingRequirements(run: Pick<ReviewRun, "requirements">, itemId: string) {
  return run.requirements.filter((r) => r.after.evidenceIds.some((id) => id === itemId));
}

/**
 * The IDs of the Requirements the submit will judge again, under the current decisions: the shared
 * `requirementsAffectedByReview`, which the backend's `final_rejudge` calls. It gets the Changes the user undid (rejected
 * or revised, their drops included as revised removes) and the final verdicts (the `after` of each row) as Coverage.
 * Three sets: a Requirement an undone Change lists; one whose Evidence cites an Item an undone `replace` or `remove`
 * targets; one whose Evidence cites a dropped bullet.
 */
export function mayChange(state: Pick<ReviewState, "changeIds" | "decisions" | "drops">, run: Pick<ReviewRun, "changes" | "requirements" | "originalCv">): Set<string> {
  const decided = applyDecisions(run.changes, toSubmission(state).decisions);
  const undone = [...decided.filter((c) => c.status === "rejected" || c.status === "revised"), ...userDrops(run.originalCv, state.drops)];
  const coverage: Coverage[] = run.requirements.map((r) => ({ requirementId: r.id, verdict: r.after.verdict, evidenceIds: r.after.evidenceIds, reason: r.after.reason }));
  return new Set(requirementsAffectedByReview(run.requirements, coverage, undone).map((r) => r.id as string));
}

/** The totals for the confirm dialog: "Accept 15, edit 2, reject 7, drop 2". */
export function decisionCounts(state: Pick<ReviewState, "changeIds" | "decisions" | "drops">) {
  const counts = { accepted: 0, edited: 0, rejected: 0, dropped: state.drops.length };
  for (const id of state.changeIds) {
    const d = state.decisions[id]?.decision ?? "accept";
    if (d === "accept") counts.accepted++;
    else if (d === "revise") counts.edited++;
    else counts.rejected++;
  }
  return counts;
}
