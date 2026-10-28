import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronRight, Link2, Trash2 } from "lucide-react";
import { ApiError, submitReview } from "@/api";
import { clearSavedReview, invalidReviewTarget, type ReviewRun, type UseReview } from "@/features/review";
import { DeleteRunDialog } from "@/features/run/DeleteRunDialog";
import { runKey } from "@/features/run/useRun";
import { ChecklistDrawer } from "@/features/review/topbar/ChecklistDrawer";
import { FIT_TOO_LONG_NOTICE, FitChip } from "@/features/review/topbar/FitChip";
import { SubmitDialog } from "@/features/review/topbar/SubmitDialog";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Menu } from "@/ui/Menu";
import { ProgressBar } from "@/ui/ProgressBar";
import { useToast } from "@/ui/Toast";

export interface ReviewTopBarProps {
  run: ReviewRun;
  /** The single useReview(run) result, owned by ReviewScreen. */
  review: UseReview;
  /** Highlight the Changes citing a Requirement while it is hovered or focused in the checklist drawer; [] clears it. */
  onHighlightChanges: (changeIds: string[]) => void;
}

function jobLine(job: ReviewRun["job"]): string {
  if (!job) return "";
  if (job.title && job.company) return `${job.title} at ${job.company}`;
  return job.title ?? job.company ?? "";
}

/** The first Change after the selected one (wrapping) that is not reviewed yet. */
function nextUnreviewed(review: UseReview): string | null {
  const { changeIds, reviewed, selectedId } = review.state;
  const start = selectedId === null ? 0 : changeIds.indexOf(selectedId) + 1;
  for (let i = 0; i < changeIds.length; i++) {
    const id = changeIds[(start + i) % changeIds.length]!;
    if (!reviewed.includes(id)) return id;
  }
  return null;
}

/**
 * The sticky Review top bar: the title, progress with "Next unreviewed", the fit chip and popover, the score chip and
 * checklist drawer, Submit Review with its dialog, and the ⋯ menu.
 *
 * Submit errors: a 202 clears the saved review and refreshes the Run (so the progress view shows). A 400 `CV_TOO_LONG` sets
 * the fit from `details.overByLines`, closes the dialog and opens the fit popover with the message and focus. A 400
 * `INVALID_REVIEW` closes the dialog, selects the named Change and shows the message in an alert under the bar (the dialog
 * would cover the card, and the card is the page's).
 */
export function ReviewTopBar({ run, review, onHighlightChanges }: ReviewTopBarProps) {
  const client = useQueryClient();
  const toast = useToast();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [fitOpen, setFitOpen] = useState(false);
  const [fitNotice, setFitNotice] = useState<string | null>(null);
  const [openFitAfterDialog, setOpenFitAfterDialog] = useState(false);
  const [invalidMessage, setInvalidMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { setFit } = review.fit;
  const mutation = useMutation({
    mutationFn: () => submitReview(run.id, review.toSubmission()),
    onSuccess: () => {
      clearSavedReview(run.id);
      void client.invalidateQueries({ queryKey: runKey(run.id) });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 400 && error.code === "CV_TOO_LONG" && typeof error.details.overByLines === "number" && error.details.overByLines >= 1) {
        setFit({ fits: false, overByLines: error.details.overByLines, fittable: true });
        setFitNotice(FIT_TOO_LONG_NOTICE);
        setOpenFitAfterDialog(true);
        setSubmitOpen(false);
      } else if (error instanceof ApiError && error.status === 400 && error.code === "INVALID_REVIEW") {
        const { changeId } = invalidReviewTarget(error.message, run, review.toSubmission());
        if (changeId !== null) review.dispatch({ type: "select", changeId });
        setInvalidMessage(error.message);
        setSubmitOpen(false);
      } else {
        setFailure("Couldn't submit your Review. Try again.");
      }
    },
  });

  // The popover opens after the dialog has closed, so the dialog's focus restore doesn't take focus back.
  useEffect(() => {
    if (!submitOpen && openFitAfterDialog) {
      setOpenFitAfterDialog(false);
      setFitOpen(true);
    }
  }, [submitOpen, openFitAfterDialog]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.show("Link copied");
    } catch {
      toast.show("Couldn't copy the link");
    }
  };

  const total = review.state.changeIds.length;
  const done = review.state.reviewed.length;
  const next = nextUnreviewed(review);
  const job = jobLine(run.job);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 md:px-6">
        <div className="min-w-0">
          <h1 className="text-lg leading-tight">Review</h1>
          {job && <p className="truncate text-[13px] text-fg-2">{job}</p>}
        </div>

        <div className="flex min-w-40 flex-col gap-1">
          <div className="flex items-center gap-3 text-[13px]">
            <span className="font-semibold tabular-nums">
              {done} of {total} reviewed
            </span>
            {next !== null && (
              <button type="button" onClick={() => review.dispatch({ type: "select", changeId: next })} className="inline-flex items-center font-semibold text-accent underline-offset-2 hover:underline">
                Next unreviewed
                <ChevronRight aria-hidden="true" size={14} strokeWidth={2} />
              </button>
            )}
          </div>
          <ProgressBar value={done} max={Math.max(total, 1)} label="Review progress" />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <FitChip
            fit={review.fit}
            open={fitOpen}
            onOpenChange={(next) => {
              setFitOpen(next);
              if (!next) setFitNotice(null);
            }}
            notice={fitNotice}
          />
          <Chip variant="status" onClick={() => setChecklistOpen(true)} className="min-h-10 px-3">
            Match Score {Math.round(run.score.before)} → {Math.round(run.score.after)}
          </Chip>
          <Button size="compact" onClick={() => setSubmitOpen(true)}>
            Submit Review
          </Button>
          <Menu
            label="Run options"
            items={[
              { label: "Copy link", icon: Link2, onSelect: copyLink },
              { label: "Delete Run", icon: Trash2, onSelect: () => setDeleting(true), tone: "danger" },
            ]}
          />
        </div>
      </div>

      {invalidMessage && (
        <div role="alert" className="flex items-center gap-2 border-t border-line bg-warn-soft px-4 py-2 text-[13px] text-danger md:px-6">
          <AlertCircle aria-hidden="true" size={16} strokeWidth={2} className="shrink-0" />
          <span className="font-semibold">{invalidMessage}</span>
          <button type="button" onClick={() => setInvalidMessage(null)} className="ml-auto font-semibold text-accent">
            Dismiss
          </button>
        </div>
      )}

      <ChecklistDrawer run={run} mayChange={review.mayChange} open={checklistOpen} onOpenChange={setChecklistOpen} onHighlightChanges={onHighlightChanges} />
      <SubmitDialog
        open={submitOpen}
        onOpenChange={(next) => {
          if (!next) {
            mutation.reset();
            setFailure(null);
          }
          setSubmitOpen(next);
          if (next) setInvalidMessage(null);
        }}
        counts={review.counts}
        busy={mutation.isPending}
        error={failure}
        onSubmit={() => {
          setFailure(null);
          mutation.mutate();
        }}
      />
      <DeleteRunDialog runId={run.id} open={deleting} onOpenChange={setDeleting} />
    </header>
  );
}
