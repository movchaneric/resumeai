// The public API of the Review logic. Screens import from here only.

/** One hook with everything a Review screen needs for a Run: state, dispatch, canDrop, mayChange, toSubmission, counts and the fit. */
export { useReview, type UseReview } from "@/features/review/useReview";
/** The fit preview on its own: debounced 600ms, cancellable, starting from the view's `fit`. */
export { useFitPreview, PREVIEW_DEBOUNCE_MS, invalidReviewTarget, type FitPreview, type FitPreviewError } from "@/features/review/useFitPreview";
/** The reducer factory, the starting state and the `sessionStorage` helpers. */
export { createReviewReducer, initialReviewState, loadReviewState, saveReviewState, clearSavedReview, reviewStorageKey } from "@/features/review/state";
/** Pure rules: the submission body, the drop check, the "may change" set, the confirm totals and the Evidence lookup. */
export { toSubmission, canDrop, mayChange, decisionCounts, citingRequirements, type CanDrop } from "@/features/review/rules";
export type { ReviewRun, ReviewState, ReviewAction, ChangeDecision, Snapshot } from "@/features/review/types";

/** The screen for an `awaiting_review` Run: top bar, rail, CV page and margin. Key it by the Run ID. */
export { ReviewScreen } from "@/features/review/ReviewScreen";
/** The CV as a document with the Changes laid over `originalCv`. `readOnly` shows kept Changes' marks only (for Done's "See what changed"). */
export { CvPage, type CvPageProps } from "@/features/review/CvPage";
/** The marks the CV page draws: the original CV with Changes (and drops) laid over it. Pure. */
export { buildCvMarks, type CvMarks, type ItemMark, type ListMarks, type MarkKind } from "@/features/review/cvMarks";
/** Maps the shared `dropProblem` message (`canDrop(...).reason`) to review.md's words. */
export { explainDrop, type DropRefusal } from "@/features/review/dropCopy";
