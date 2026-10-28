import { useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import type { ReviewFit } from "@resume-ai/shared";
import type { UseReview } from "@/features/review";
import { Button } from "@/ui/Button";
import { cx } from "@/ui/cx";

const STEPS = 7;

export const FIT_TOO_LONG_NOTICE = "Your choices run past one page. Reject an addition or drop a bullet, then submit again.";

const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;

/** The chip's text for a fit. */
export function fitLabel(fit: ReviewFit): string {
  return fit.fits ? "Fits one page" : `${lines(fit.overByLines)} over one page`;
}

/** The popover's sentence for a fit. */
export function fitSentence(fit: ReviewFit): string {
  return fit.fits ? `Fits one page at size step ${fit.step + 1} of ${STEPS}` : `${lines(fit.overByLines)} over one page, even at the smallest size`;
}

/** Seven size steps, plus an overflow segment when the CV is over. Drawn with tokens; the text next to it says the same. */
function SizeBar({ fit }: { fit: ReviewFit }) {
  const label = fit.fits ? `Size step ${fit.step + 1} of ${STEPS}` : `All ${STEPS} size steps used, ${lines(fit.overByLines)} over`;
  return (
    <div role="img" aria-label={label} className="flex gap-1">
      {Array.from({ length: STEPS }, (_, i) => (
        <span key={i} className={cx("h-2 flex-1 rounded-full", fit.fits ? (i <= fit.step ? "bg-ok" : "bg-soft") : "bg-warn-line")} />
      ))}
      {!fit.fits && <span className="h-2 w-6 rounded-full bg-danger" />}
    </div>
  );
}

export interface FitChipProps {
  fit: UseReview["fit"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The message to show in the popover (the `CV_TOO_LONG` notice); focus moves into the popover while it is set. */
  notice: string | null;
  /** Show the details as a bottom sheet (phone focus mode) instead of a popover. */
  sheet?: boolean;
}

/**
 * The fit chip and its popover. The chip sits in the screen's one `role="status"` region, so a change of fit is announced.
 * Fits, over and checking are the three states; a failed preview keeps the last fit and says so in the popover.
 */
export function FitChip({ fit: preview, open, onOpenChange, notice, sheet = false }: FitChipProps) {
  const { fit, checking, error, retry } = preview;
  const contentRef = useRef<HTMLDivElement>(null);
  const failed = error !== null && error.kind !== "invalid";

  useEffect(() => {
    if (!open || !notice) return;
    const timer = setTimeout(() => contentRef.current?.focus(), 0); // after a closing dialog gives focus back
    return () => clearTimeout(timer);
  }, [open, notice]);

  const tone = checking ? "bg-surface text-fg ring-fg-3" : fit.fits ? "bg-ok-soft text-ok ring-ok" : "bg-warn-soft text-warn-fg ring-warn-line";
  const text = checking ? "Checking fit…" : fitLabel(fit);

  const triggerClass = cx("inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold tabular-nums ring-1 transition-colors duration-150 hover:bg-soft", tone);
  const triggerLabel = `${text}. Show details`;
  const triggerBody = (
    <>
      {checking ? (
        <Loader2 aria-hidden="true" size={14} strokeWidth={2} className="animate-spin motion-reduce:animate-none" />
      ) : fit.fits ? (
        <Check aria-hidden="true" size={14} strokeWidth={2.5} />
      ) : (
        <AlertTriangle aria-hidden="true" size={14} strokeWidth={2} />
      )}
      {text}
    </>
  );
  const trigger = (
    <div role="status">
      {sheet ? (
        <Dialog.Trigger className={triggerClass} aria-label={triggerLabel}>
          {triggerBody}
        </Dialog.Trigger>
      ) : (
        <Popover.Trigger className={triggerClass} aria-label={triggerLabel}>
          {triggerBody}
        </Popover.Trigger>
      )}
    </div>
  );

  const details = (
    <>
      {notice && (
        <p role="alert" className="font-semibold text-danger">
          {notice}
        </p>
      )}
      <p className="font-semibold">{fitSentence(fit)}</p>
      <SizeBar fit={fit} />
      {!fit.fits && <p className="text-fg-2">Reject an addition, or drop a bullet.</p>}
      {!fit.fittable && <p className="text-fg-2">This CV can&apos;t fit one page even with every removal, so you can submit it as it is.</p>}
      {error && (
        <div className="flex flex-col items-start gap-2 text-danger">
          <p className="font-semibold">{failed ? "Couldn't check the fit" : error.message}</p>
          {failed && (
            <Button variant="secondary" size="compact" onClick={retry}>
              Retry
            </Button>
          )}
        </div>
      )}
    </>
  );

  if (sheet) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        {trigger}
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-fg/40" />
          <Dialog.Content
            ref={contentRef}
            tabIndex={-1}
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80vh] flex-col gap-3 overflow-y-auto rounded-t-hero bg-surface p-5 pb-8 text-sm shadow-xl outline-none"
          >
            <div className="flex items-start justify-between gap-2">
              <Dialog.Title className="text-lg font-bold">Page fit</Dialog.Title>
              <Dialog.Close aria-label="Close page fit" className="inline-flex size-10 items-center justify-center rounded-btn text-fg-2 hover:bg-soft">
                <X aria-hidden="true" size={18} strokeWidth={2} />
              </Dialog.Close>
            </div>
            {details}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {trigger}
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          tabIndex={-1}
          aria-label="Page fit"
          align="center"
          sideOffset={8}
          className="z-40 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-tile bg-surface p-4 text-sm shadow-lg ring-1 ring-line outline-none"
        >
          {details}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
