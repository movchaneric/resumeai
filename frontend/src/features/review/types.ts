import type { ItemId, ReviewDecision, RunView } from "@resume-ai/shared";

/** The Run view the Review screen works on. */
export type ReviewRun = Extract<RunView, { status: "awaiting_review" }>;

/** What the user decided about one Change. `after` and `orderedItemIds` are set only for a `revise`. */
export interface ChangeDecision {
  decision: ReviewDecision["decision"];
  after?: string;
  orderedItemIds?: ItemId[];
}

/** The part of the Review the user can undo: the decisions and the drops. */
export interface Snapshot {
  decisions: Record<string, ChangeDecision>;
  drops: ItemId[];
}

export interface ReviewState extends Snapshot {
  runId: string;
  /** Every Change ID of the Run, in the Run's order. */
  changeIds: string[];
  /** The Changes the user has selected, decided or confirmed in bulk. */
  reviewed: string[];
  selectedId: string | null;
  /** Earlier states, newest last. Kept in memory only; never saved. */
  undo: Snapshot[];
}

export type ReviewAction =
  | { type: "accept"; changeId: string }
  | { type: "reject"; changeId: string }
  | { type: "revise"; changeId: string; after?: string; orderedItemIds?: ItemId[] }
  | { type: "drop"; itemId: ItemId }
  | { type: "undrop"; itemId: ItemId }
  | { type: "bulk"; decision: "accept" | "reject"; changeIds: string[] }
  | { type: "select"; changeId: string | null }
  | { type: "undo" };
