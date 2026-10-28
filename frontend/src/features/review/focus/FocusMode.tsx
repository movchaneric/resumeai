import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileText } from "lucide-react";
import type { ItemId } from "@resume-ai/shared";
import { Button } from "@/ui/Button";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { useToast, type ToastOptions } from "@/ui/Toast";
import { cx } from "@/ui/cx";
import { buildCards, textsWithAdds } from "@/features/review/cards";
import { buildCvMarks } from "@/features/review/cvMarks";
import { explainDrop } from "@/features/review/dropCopy";
import { decidedChanges } from "@/features/review/rules";
import { FocusCard } from "@/features/review/focus/FocusCard";
import { WholeCv } from "@/features/review/focus/WholeCv";
import { ReviewTopBar } from "@/features/review/topbar/ReviewTopBar";
import type { ReviewRun } from "@/features/review/types";
import type { UseReview } from "@/features/review/useReview";

const UNDO_MS = 6000;

const NAV = "inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-btn px-2 text-[14px] font-semibold text-accent hover:bg-accent-soft disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * The Review screen below 1024px: one Change at a time, with the bottom bar for the decision and for moving on. It works on
 * the same `useReview` result as the desktop layout, so decisions, drops and the fit are shared. Swiping a card is an extra
 * (see `FocusCard`); the desktop shortcuts are not attached here.
 */
export function FocusMode({ run, review, notice }: { run: ReviewRun; review: UseReview; notice: string }) {
  const { state, dispatch } = review;
  const toast = useToast();

  const [checklistOpen, setChecklistOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cvOpen, setCvOpen] = useState(false);
  const [pickedItem, setPickedItem] = useState<string | null>(null);
  const [cvChange, setCvChange] = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop] = useState<{ itemId: ItemId; requirements: string[] } | null>(null);

  const decided = useMemo(() => decidedChanges(run, state), [run, state]);
  const cards = useMemo(() => buildCards(run, state.drops), [run, state.drops]);
  const marks = useMemo(() => buildCvMarks(run.originalCv, decided, state.drops), [run.originalCv, decided, state.drops]);
  const texts = useMemo(() => textsWithAdds(run.originalCv, run.changes), [run.originalCv, run.changes]);
  const reviewed = useMemo(() => new Set(state.reviewed), [state.reviewed]);
  const changeCards = useMemo(() => cards.flatMap((card) => (card.kind === "change" ? [card] : [])), [cards]);

  const selectedId = state.selectedId;
  const index = Math.max(0, changeCards.findIndex((c) => c.change.id === selectedId));
  const current = changeCards[index];
  const currentId = current?.change.id as string | undefined;

  // The card on show counts as seen.
  useEffect(() => {
    if (selectedId === null && currentId) dispatch({ type: "select", changeId: currentId });
  }, [selectedId, currentId, dispatch]);

  // Moving to another card ends an edit and moves focus to the card.
  const previous = useRef<string | null>(null);
  useEffect(() => {
    setEditing(false);
    const before = previous.current;
    previous.current = selectedId;
    if (selectedId && before !== null && !cvOpen) document.querySelector<HTMLElement>(`[data-card-id="${selectedId.replace(/["\\]/g, "\\$&")}"]`)?.focus({ preventScroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const go = (delta: 1 | -1) => {
    const next = changeCards[index + delta];
    if (next) dispatch({ type: "select", changeId: next.change.id });
  };

  // --- toasts with Undo, and the notice when a decision gives a drop back ---
  const undoOptions: ToastOptions = { durationMs: UNDO_MS, action: { label: "Undo", onSelect: () => dispatch({ type: "undo" }) } };
  const decisionMade = useRef(false);
  const lastDrops = useRef<ItemId[]>(state.drops);
  useEffect(() => {
    const gone = lastDrops.current.filter((d) => !state.drops.includes(d));
    if (gone.length > 0 && decisionMade.current) {
      toast.show(`${gone.length === 1 ? "A bullet you dropped is back" : "Bullets you dropped are back"}, because you kept its Change.`, undoOptions);
    }
    lastDrops.current = state.drops;
    decisionMade.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const decide = (changeId: string, decision: "accept" | "reject") => {
    if (state.decisions[changeId]?.decision === decision) {
      dispatch({ type: decision, changeId });
      return;
    }
    decisionMade.current = true;
    dispatch({ type: decision, changeId });
    toast.show(decision === "accept" ? "Change accepted" : "Change rejected", undoOptions);
  };

  const save = (changeId: string, value: { after?: string; orderedItemIds?: ItemId[] }) => {
    decisionMade.current = true;
    dispatch({ type: "revise", changeId, ...value });
    setEditing(false);
    toast.show("Change edited", undoOptions);
  };

  // --- drops, from the whole-CV view ---
  const doDrop = (itemId: ItemId) => {
    dispatch({ type: "drop", itemId });
    setPickedItem(null);
    toast.show("Bullet dropped", undoOptions);
  };
  const attemptDrop = (itemId: string) => {
    if (!marks.isBullet(itemId) || !review.canDrop(itemId as ItemId).ok) return;
    const citing = review.citingRequirements(itemId);
    if (citing.length > 0) setConfirmDrop({ itemId: itemId as ItemId, requirements: citing.map((r) => r.text) });
    else doDrop(itemId as ItemId);
  };
  const itemControls = (itemId: string) => {
    if (!marks.isBullet(itemId) || state.drops.includes(itemId as ItemId)) return null;
    const check = review.canDrop(itemId as ItemId);
    const refusal = check.ok ? null : explainDrop(check.reason);
    const showButton = check.ok || refusal?.kind === "last" || refusal?.kind === "reworded";
    return (
      <div className="flex flex-wrap items-center gap-2 px-1 pb-1.5">
        {showButton && (
          <Button size="compact" variant="secondary" disabled={!check.ok} onClick={() => attemptDrop(itemId)} className="min-h-11 px-4 text-[14px]">
            Drop
          </Button>
        )}
        {refusal && <p className="text-xs text-fg-2">{refusal.message}</p>}
      </div>
    );
  };

  const openCv = () => {
    setCvChange(selectedId);
    setPickedItem(null);
    setCvOpen(true);
  };

  const invalid = review.fit.error?.kind === "invalid" ? review.fit.error : null;
  const decision = currentId ? state.decisions[currentId] : undefined;
  const isRemove = current?.change.op === "remove";
  const allSeen = changeCards.length === 0 || changeCards.every((c) => reviewed.has(c.change.id));
  const over = review.fit.fit.fits ? 0 : review.fit.fit.overByLines;

  return (
    <div className="pb-48">
      <ReviewTopBar
        compact
        run={run}
        review={review}
        onHighlightChanges={() => {}}
        checklistOpen={checklistOpen}
        onChecklistOpenChange={setChecklistOpen}
        submitOpen={submitOpen}
        onSubmitOpenChange={setSubmitOpen}
      />
      {notice && <p className="px-4 pt-3 text-sm font-semibold text-fg-2">{notice}</p>}

      <main className="flex flex-col gap-3 px-4 py-4">
        {current ? (
          <FocusCard
            key={current.change.id}
            run={run}
            card={current}
            decision={decision}
            reviewed={reviewed.has(current.change.id)}
            error={invalid?.changeId === current.change.id ? invalid.message : null}
            texts={texts}
            onSave={(value) => save(current.change.id, value)}
            onShowInCv={openCv}
            onSwipe={go}
            edit={{ editing, setEditing }}
          />
        ) : (
          <p className="rounded-tile bg-surface p-4 text-[15px] ring-1 ring-line">There are no Changes to review. You can look at the whole CV, or submit.</p>
        )}
        {over > 0 && (
          <p className="rounded-tile border border-dashed border-fg-3 p-3 text-[13px] text-fg-2">
            Still {over} {over === 1 ? "line" : "lines"} over. Reject an addition, or open the whole CV, tap a bullet and drop it.
          </p>
        )}
        {state.drops.length > 0 && <p className="text-[13px] text-fg-2">{state.drops.length === 1 ? "1 bullet dropped by you." : `${state.drops.length} bullets dropped by you.`}</p>}
      </main>

      <nav aria-label="Review actions" className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-1 border-t border-line bg-surface/95 px-4 pt-3 pb-3 backdrop-blur">
        {current && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={decision?.decision === "reject"}
              onClick={() => decide(current.change.id, "reject")}
              className={cx(
                "min-h-12 rounded-btn text-[15px] font-semibold transition-colors duration-150",
                decision?.decision === "reject" ? "bg-danger text-surface" : "bg-surface text-fg ring-1 ring-fg-3 hover:bg-soft",
              )}
            >
              {isRemove ? "Keep it" : "Reject"}
            </button>
            <button
              type="button"
              aria-pressed={decision?.decision === "accept"}
              onClick={() => decide(current.change.id, "accept")}
              className={cx(
                "min-h-12 rounded-btn text-[15px] font-semibold transition-colors duration-150",
                decision?.decision === "accept" ? "bg-ok text-surface" : "bg-surface text-fg ring-1 ring-fg-3 hover:bg-soft",
              )}
            >
              {isRemove ? "Remove" : "Accept"}
            </button>
          </div>
        )}
        <div className="flex items-center">
          <button type="button" className={NAV} disabled={index <= 0 || !current} onClick={() => go(-1)}>
            <ChevronLeft aria-hidden="true" size={16} strokeWidth={2.25} />
            Previous
          </button>
          <button type="button" className={NAV} onClick={openCv}>
            <FileText aria-hidden="true" size={16} strokeWidth={2} />
            See the whole CV
          </button>
          <button type="button" className={NAV} disabled={index >= changeCards.length - 1 || !current} onClick={() => go(1)}>
            Skip
            <ChevronRight aria-hidden="true" size={16} strokeWidth={2.25} />
          </button>
        </div>
        {allSeen && (
          <Button onClick={() => setSubmitOpen(true)} className="w-full">
            Submit Review
          </Button>
        )}
      </nav>

      <WholeCv
        open={cvOpen}
        onOpenChange={setCvOpen}
        cv={run.originalCv}
        changes={decided}
        drops={state.drops}
        selectedChangeId={cvChange}
        selectedItemId={pickedItem}
        onSelectChange={(changeId, itemId) => {
          setCvChange(changeId);
          setPickedItem(itemId);
          dispatch({ type: "select", changeId });
        }}
        onSelectItem={(itemId) => {
          setCvChange(null);
          setPickedItem(itemId);
        }}
        itemControls={itemControls}
      />

      <ConfirmDialog
        open={confirmDrop !== null}
        onOpenChange={(open) => !open && setConfirmDrop(null)}
        title="Drop this bullet?"
        description={`This bullet is Evidence for ${(confirmDrop?.requirements ?? []).map((t) => `'${t}'`).join(" and ")}. Dropping it may lower the score.`}
        confirmLabel="Drop bullet"
        busyLabel="Dropping…"
        onConfirm={() => {
          if (confirmDrop) doDrop(confirmDrop.itemId);
          setConfirmDrop(null);
        }}
      />
    </div>
  );
}
