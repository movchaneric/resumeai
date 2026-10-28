import { useEffect, useRef, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { Change, Cv, ItemId } from "@resume-ai/shared";
import { CvPage } from "@/features/review/CvPage";

export interface WholeCvProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cv: Cv;
  changes: Change[];
  drops: ItemId[];
  selectedChangeId: string | null;
  selectedItemId: string | null;
  onSelectChange: (changeId: string, itemId: string | null) => void;
  onSelectItem: (itemId: string) => void;
  itemControls: (itemId: string) => ReactNode;
}

function Scroller({ changeId, children }: { changeId: string | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(changeId);
  useEffect(() => {
    // Open on the Change the card was showing.
    const id = first.current;
    if (!id) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.querySelector<HTMLElement>(`[data-change-id="${id.replace(/["\\]/g, "\\$&")}"]`)?.scrollIntoView?.({ block: "center", behavior: reduced ? "auto" : "smooth" });
  }, []);
  return <div ref={ref}>{children}</div>;
}

/** The whole CV with its marks, full screen: tap a mark to pick its Change, tap a bullet and use Drop. */
export function WholeCv({ open, onOpenChange, cv, changes, drops, selectedChangeId, selectedItemId, onSelectChange, onSelectItem, itemControls }: WholeCvProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content aria-describedby={undefined} className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-bg outline-none">
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-line bg-surface/90 px-4 py-2 backdrop-blur">
            <Dialog.Title className="text-lg font-bold">Your CV</Dialog.Title>
            <Dialog.Close className="inline-flex min-h-11 items-center gap-1.5 rounded-btn px-3 text-[15px] font-semibold text-accent hover:bg-accent-soft">
              <X aria-hidden="true" size={18} strokeWidth={2} />
              Back to the Change
            </Dialog.Close>
          </div>
          <p className="px-4 pt-3 text-[13px] text-fg-2">Tap a bullet, then Drop, to leave it out. Tap a mark to pick its Change.</p>
          <div className="p-4">
            <Scroller changeId={selectedChangeId}>
              <CvPage
                cv={cv}
                changes={changes}
                drops={drops}
                selectedChangeId={selectedChangeId}
                selectedItemId={selectedItemId}
                onSelectChange={onSelectChange}
                onSelectItem={onSelectItem}
                itemControls={itemControls}
              />
            </Scroller>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
