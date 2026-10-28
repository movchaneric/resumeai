import type { UseReview } from "@/features/review";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

/** "Accept 15, edit 2, reject 7, drop 2. The Review is final." */
export function totalsLine(counts: UseReview["counts"]): string {
  return `Accept ${counts.accepted}, edit ${counts.edited}, reject ${counts.rejected}, drop ${counts.dropped}. The Review is final.`;
}

export interface SubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  counts: UseReview["counts"];
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
}

/** The confirm before the Review is sent. */
export function SubmitDialog({ open, onOpenChange, counts, busy, error, onSubmit }: SubmitDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Submit your Review?"
      description={totalsLine(counts)}
      confirmLabel="Submit Review"
      busyLabel="Submitting…"
      cancelLabel="Keep reviewing"
      busy={busy}
      error={error}
      onConfirm={onSubmit}
    />
  );
}
