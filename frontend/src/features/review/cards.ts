import { applyChanges, textItems } from "@resume-ai/shared";
import type { Change, Cv, ItemId } from "@resume-ai/shared";
import { anchorOf, locate, positionOf, readingOrder } from "@/features/review/locate";
import type { ChangeDecision, ReviewRun, ReviewState } from "@/features/review/types";

export type ReviewFilter = "all" | "replace" | "add" | "remove" | "unreviewed";

export const FILTERS: { id: ReviewFilter; label: string }[] = [
  { id: "all", label: "All changes" },
  { id: "replace", label: "Rewordings" },
  { id: "add", label: "Additions" },
  { id: "remove", label: "Removals" },
  { id: "unreviewed", label: "Unreviewed" },
];

export const TYPE_LABEL: Record<Change["op"], string> = { replace: "Rewording", add: "Addition", remove: "Removal", reorder: "Reordering" };

export type StatusWord = "Accepted" | "Rejected" | "Edited" | "To review";

/** The status word of a card: a Change not looked at yet is "To review", whatever its starting decision. */
export function statusWord(reviewed: boolean, decision: ChangeDecision["decision"] | undefined): StatusWord {
  if (!reviewed) return "To review";
  if (decision === "reject") return "Rejected";
  if (decision === "revise") return "Edited";
  return "Accepted";
}

export function matchesFilter(filter: ReviewFilter, change: Change, reviewed: boolean): boolean {
  if (filter === "all") return true;
  if (filter === "unreviewed") return !reviewed;
  return change.op === filter;
}

export type Card =
  | { kind: "change"; change: Change; number: number; total: number; section: string; entry: string | null; position: number }
  | { kind: "drop"; itemId: ItemId; text: string; section: string; entry: string | null; position: number };

/** One card per Change, in CV order, and one per user drop. `number` is the Change's place among the Changes (1-based). */
export function buildCards(run: Pick<ReviewRun, "originalCv" | "changes">, drops: ItemId[]): Card[] {
  const cv = run.originalCv;
  const order = readingOrder(cv);
  const texts = textItems(cv);
  const changes = run.changes
    .map((change, index) => ({ change, index, position: positionOf(cv, order, change) }))
    .sort((a, b) => a.position - b.position || a.index - b.index);
  const total = changes.length;
  const cards: Card[] = changes.map(({ change, position }, n) => {
    const place = locate(cv, anchorOf(change));
    return { kind: "change", change, number: n + 1, total, section: place.section, entry: place.entry, position };
  });
  for (const itemId of drops) {
    const place = locate(cv, itemId);
    cards.push({ kind: "drop", itemId, text: texts.get(itemId)?.text ?? "", section: place.section, entry: place.entry, position: order.get(itemId) ?? Number.MAX_SAFE_INTEGER });
  }
  return cards.sort((a, b) => a.position - b.position);
}

/** The words a card shows in its collapsed line: what the Change puts in, or what it takes out. */
export function previewOf(change: Change, decision: ChangeDecision | undefined, texts: Map<string, string>): string {
  if (change.op === "remove") return change.before;
  if (change.op === "reorder") {
    const ids = decision?.decision === "revise" && decision.orderedItemIds ? decision.orderedItemIds : change.orderedItemIds;
    return ids.map((id) => texts.get(id) ?? id).join(", ");
  }
  return decision?.decision === "revise" && decision.after ? decision.after : change.after;
}

/** The text of every Item in the original CV plus the Items the Changes add, to name the Items of a reorder. */
export function textsWithAdds(cv: Cv, changes: Change[]): Map<string, string> {
  const out = new Map<string, string>();
  try {
    for (const [id, item] of textItems(applyChanges(cv, changes.filter((c) => c.op === "add")))) out.set(id, item.text);
  } catch {
    for (const [id, item] of textItems(cv)) out.set(id, item.text);
  }
  return out;
}

export function counts(run: Pick<ReviewRun, "changes">, state: Pick<ReviewState, "reviewed">): Record<ReviewFilter, number> {
  const reviewed = new Set(state.reviewed);
  const out: Record<ReviewFilter, number> = { all: run.changes.length, replace: 0, add: 0, remove: 0, unreviewed: 0 };
  for (const c of run.changes) {
    if (c.op !== "reorder") out[c.op]++;
    if (!reviewed.has(c.id)) out.unreviewed++;
  }
  return out;
}
