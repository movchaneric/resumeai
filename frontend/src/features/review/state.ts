import { z } from "zod";
import type { ItemId } from "@resume-ai/shared";
import { dropsProblem } from "@/features/review/rules";
import type { ChangeDecision, ReviewAction, ReviewRun, ReviewState, Snapshot } from "@/features/review/types";

const UNDO_LIMIT = 100;

/** Every Change accepted, no drops, nothing reviewed: the state the view's `fit` describes. */
export function initialReviewState(run: ReviewRun): ReviewState {
  const changeIds = run.changes.map((c) => c.id as string);
  return {
    runId: run.id,
    changeIds,
    decisions: Object.fromEntries(changeIds.map((id) => [id, { decision: "accept" } satisfies ChangeDecision])),
    drops: [],
    reviewed: [],
    selectedId: null,
    undo: [],
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Keeps the drops the decisions still allow, in order. Accepting a rewording of a dropped bullet, or a removal that
 * leaves a job empty, would make the server answer 400, so the drop gives way to the user's latest choice.
 */
function pruneDrops(run: ReviewRun, state: Pick<ReviewState, "changeIds" | "decisions" | "drops">): ItemId[] {
  const kept: ItemId[] = [];
  for (const drop of state.drops) {
    if (dropsProblem(run, state, [...kept, drop]) === null) kept.push(drop);
  }
  return kept;
}

/** The reducer for one Run. Pure; the Run supplies the Changes the drop rules need. */
export function createReviewReducer(run: ReviewRun) {
  const known = new Set(run.changes.map((c) => c.id as string));
  const changeById = new Map(run.changes.map((c) => [c.id as string, c]));

  const markReviewed = (state: ReviewState, ids: string[]): string[] => {
    const add = ids.filter((id) => !state.reviewed.includes(id));
    return add.length === 0 ? state.reviewed : [...state.reviewed, ...add];
  };

  /** Applies new decisions (and the drops they leave valid), pushing an undo step only when something changed. */
  const commit = (state: ReviewState, decisions: Record<string, ChangeDecision>, drops: ItemId[], reviewedIds: string[]): ReviewState => {
    const pruned = pruneDrops(run, { changeIds: state.changeIds, decisions, drops });
    const reviewed = markReviewed(state, reviewedIds);
    if (same(decisions, state.decisions) && same(pruned, state.drops)) return reviewed === state.reviewed ? state : { ...state, reviewed };
    const before: Snapshot = { decisions: state.decisions, drops: state.drops };
    return { ...state, decisions, drops: pruned, reviewed, undo: [...state.undo, before].slice(-UNDO_LIMIT) };
  };

  return function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
    switch (action.type) {
      case "accept":
      case "reject": {
        if (!known.has(action.changeId)) return state;
        const decision = action.type === "accept" ? "accept" : "reject";
        return commit(state, { ...state.decisions, [action.changeId]: { decision } }, state.drops, [action.changeId]);
      }
      case "revise": {
        const change = changeById.get(action.changeId);
        if (!change || change.op === "remove") return state;
        if (change.op === "reorder") {
          if (!action.orderedItemIds) return state;
          return commit(state, { ...state.decisions, [change.id]: { decision: "revise", orderedItemIds: action.orderedItemIds } }, state.drops, [change.id]);
        }
        const after = action.after?.trim();
        if (!after) return state;
        return commit(state, { ...state.decisions, [change.id]: { decision: "revise", after } }, state.drops, [change.id]);
      }
      case "bulk": {
        const decisions = { ...state.decisions };
        const ids = action.changeIds.filter((id) => known.has(id));
        // The user's own words are not overwritten by a bulk action.
        for (const id of ids) if (decisions[id]?.decision !== "revise") decisions[id] = { decision: action.decision };
        return commit(state, decisions, state.drops, ids);
      }
      case "drop": {
        if (dropsProblem(run, state, [...state.drops, action.itemId]) !== null) return state;
        return commit(state, state.decisions, [...state.drops, action.itemId], []);
      }
      case "undrop": {
        if (!state.drops.includes(action.itemId)) return state;
        return commit(state, state.decisions, state.drops.filter((d) => d !== action.itemId), []);
      }
      case "select": {
        if (action.changeId === null) return { ...state, selectedId: null };
        if (!known.has(action.changeId)) return state;
        return { ...state, selectedId: action.changeId, reviewed: markReviewed(state, [action.changeId]) };
      }
      case "undo": {
        const previous = state.undo[state.undo.length - 1];
        if (!previous) return state;
        return { ...state, ...previous, undo: state.undo.slice(0, -1) };
      }
    }
  };
}

// --- sessionStorage, one key per Run ---

export const reviewStorageKey = (runId: string) => `resume-ai:review:${runId}`;

const SavedSchema = z.object({
  v: z.literal(1),
  changeIds: z.array(z.string()),
  decisions: z.record(
    z.string(),
    z.object({ decision: z.enum(["accept", "reject", "revise"]), after: z.string().optional(), orderedItemIds: z.array(z.string()).optional() }),
  ),
  drops: z.array(z.string()),
  reviewed: z.array(z.string()),
  selectedId: z.string().nullable(),
});

/** Saves the state for its Run (without the undo stack). A storage failure is ignored: the Review still works for the visit. */
export function saveReviewState(state: ReviewState): void {
  try {
    const { runId, changeIds, decisions, drops, reviewed, selectedId } = state;
    window.sessionStorage.setItem(reviewStorageKey(runId), JSON.stringify({ v: 1, changeIds, decisions, drops, reviewed, selectedId }));
  } catch {
    // Storage is unavailable (a private window, blocked site data).
  }
}

/** Removes the saved state of a Run, for example after a successful submit. */
export function clearSavedReview(runId: string): void {
  try {
    window.sessionStorage.removeItem(reviewStorageKey(runId));
  } catch {
    // Nothing to clear.
  }
}

/** The saved state for this Run, or null when there is none, it is unreadable, or its Change IDs are not the Run's. */
export function loadReviewState(run: ReviewRun): ReviewState | null {
  try {
    const raw = window.sessionStorage.getItem(reviewStorageKey(run.id));
    if (raw === null) return null;
    const parsed = SavedSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const saved = parsed.data;
    const ids = run.changes.map((c) => c.id as string);
    if (saved.changeIds.length !== ids.length || !ids.every((id, i) => saved.changeIds[i] === id)) return null;
    const fresh = initialReviewState(run);
    const changes = new Map(run.changes.map((c) => [c.id as string, c]));
    const decisions: Record<string, ChangeDecision> = {};
    for (const id of ids) {
      const d = saved.decisions[id];
      const op = changes.get(id)!.op;
      // A saved revision must still fit its Change; anything odd falls back to accepted.
      const ok = d && (d.decision !== "revise" || (op === "reorder" ? d.orderedItemIds !== undefined : op !== "remove" && !!d.after));
      decisions[id] = ok ? (d as ChangeDecision) : { decision: "accept" };
    }
    const state: ReviewState = {
      ...fresh,
      decisions,
      drops: saved.drops as ItemId[],
      reviewed: saved.reviewed.filter((id) => ids.includes(id)),
      selectedId: saved.selectedId !== null && ids.includes(saved.selectedId) ? saved.selectedId : null,
    };
    return { ...state, drops: pruneDrops(run, state) };
  } catch {
    return null;
  }
}
