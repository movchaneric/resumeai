import type { ReviewRun, UseReview } from "@/features/review";

export interface ReviewTopBarProps {
  run: ReviewRun;
  /** The single useReview(run) result, owned by ReviewScreen. */
  review: UseReview;
  /** Highlight the Changes citing a Requirement while it is hovered or focused in the checklist drawer; [] clears it. */
  onHighlightChanges: (changeIds: string[]) => void;
}

/** STUB (#75): progress text and an inert Submit button, so the page can be built and tested. #76 replaces this file. */
export function ReviewTopBar({ run, review }: ReviewTopBarProps) {
  return (
    <div className="sticky top-14 z-20 flex items-center gap-4 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur-sm">
      <h1 className="text-xl">Review</h1>
      <p role="status" className="text-sm font-semibold text-fg-2">
        {review.state.reviewed.length} of {run.changes.length} reviewed
      </p>
      <button type="button" className="ml-auto rounded-btn bg-fg px-5 py-2 text-[15px] font-semibold text-surface">
        Submit Review
      </button>
    </div>
  );
}
