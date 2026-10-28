export type DropRefusal = "duplicate" | "added" | "not_bullet" | "removed" | "reworded" | "last" | "other";

/** The user-facing words (review.md) for each reason the shared `dropProblem` can give. */
const COPY: Record<Exclude<DropRefusal, "other">, string> = {
  duplicate: "You already dropped this bullet.",
  added: "Reject its addition to remove it.",
  not_bullet: "Only a bullet under a job, project or education entry can be dropped.",
  removed: "Already removed by an accepted Change.",
  reworded: "Reject its rewording to drop it.",
  last: "Each job keeps at least one bullet.",
};

/**
 * Maps the message of the shared `dropProblem` (`canDrop(...).reason`) to the kind of refusal and its words. It matches the
 * stable parts of each message, not the IDs; an unknown message comes back as it is, so the user still sees a reason.
 */
export function explainDrop(reason: string): { kind: DropRefusal; message: string } {
  const kind = refusalKind(reason);
  return { kind, message: kind === "other" ? reason : COPY[kind] };
}

function refusalKind(reason: string): DropRefusal {
  if (/appears more than once/.test(reason)) return "duplicate";
  if (/the tailor added this bullet/.test(reason)) return "added";
  if (/not a bullet of a job, project or education entry/.test(reason)) return "not_bullet";
  if (/already removes it/.test(reason)) return "removed";
  if (/to drop it\.?$/.test(reason)) return "reworded";
  if (/would be left with no bullet/.test(reason)) return "last";
  return "other";
}
