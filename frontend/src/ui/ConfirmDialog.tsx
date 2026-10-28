import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle } from "lucide-react";
import { Button } from "@/ui/Button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  /** The confirm label while `busy`, for example "Deleting…". */
  busyLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  /** A message shown above the buttons when the action failed. */
  error?: string | null;
  tone?: "default" | "danger";
  onConfirm: () => void;
}

/** A modal that asks before an action that cannot be undone. Radix handles focus trapping, Escape and restoring focus. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, busyLabel, cancelLabel = "Cancel", busy = false, error, tone = "default", onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-fg/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-hero bg-surface p-6 shadow-xl ring-1 ring-line">
          <Dialog.Title className="text-xl font-bold tracking-tight">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-[15px] text-fg-2">{description}</Dialog.Description>
          {error && (
            <p role="alert" className="mt-4 flex items-center gap-1.5 text-[13px] text-danger">
              <AlertCircle aria-hidden="true" size={16} strokeWidth={2} />
              {error}
            </p>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close asChild>
              <Button variant="secondary" disabled={busy}>
                {cancelLabel}
              </Button>
            </Dialog.Close>
            <Button variant={tone === "danger" ? "danger" : "primary"} busy={busy} onClick={onConfirm} className={tone === "danger" ? "ring-1 ring-danger" : undefined}>
              {busy ? busyLabel : confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
