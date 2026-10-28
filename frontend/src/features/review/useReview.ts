import { useEffect, useMemo, useReducer } from "react";
import type { ItemId } from "@resume-ai/shared";
import { createReviewReducer, initialReviewState, loadReviewState, saveReviewState } from "@/features/review/state";
import { canDrop, decisionCounts, mayChange, citingRequirements, toSubmission } from "@/features/review/rules";
import { useFitPreview } from "@/features/review/useFitPreview";
import type { ReviewAction, ReviewRun, ReviewState } from "@/features/review/types";

/**
 * Everything the Review screens need, for one Run. Mount it once per Run (key the component by the Run ID): the state is
 * restored from `sessionStorage` on mount and saved after each change.
 */
export function useReview(run: ReviewRun) {
  const reducer = useMemo(() => createReviewReducer(run), [run]);
  const [state, dispatch] = useReducer(reducer, run, (r): ReviewState => loadReviewState(r) ?? initialReviewState(r));

  useEffect(() => saveReviewState(state), [state]);

  const fit = useFitPreview(run, state);

  return {
    /** The decisions, drops, reviewed set, selection and undo stack. */
    state,
    /** Sends one action to the reducer (accept, reject, revise, drop, undrop, bulk, select, undo). */
    dispatch,
    /** Whether this bullet can be dropped now: `{ ok: true }` or `{ ok: false, reason }`. */
    canDrop: (itemId: ItemId) => canDrop(run, state, itemId),
    /** The IDs of the Requirements the submit will re-judge under the current decisions. */
    mayChange: useMemo(() => mayChange(state, run), [state, run]),
    /** The body for `submitReview` and the preview. */
    toSubmission: () => toSubmission(state),
    /** The totals for the confirm dialog. */
    counts: decisionCounts(state),
    /** The Requirements whose final verdict cites this Item (for the confirm before dropping a cited bullet). */
    citingRequirements: (itemId: string) => citingRequirements(run, itemId),
    /** The live fit: `{ fit, checking, error, retry, setFit }`. */
    fit,
    /** True when there is something to undo. */
    canUndo: state.undo.length > 0,
  };
}

export type UseReview = ReturnType<typeof useReview>;
export type { ReviewAction };
