import { useEffect, useMemo, useRef, useState } from "react";
import type { ItemId } from "@resume-ai/shared";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Button } from "@/ui/Button";
import { Kbd } from "@/ui/Kbd";
import { useToast, type ToastOptions } from "@/ui/Toast";
import { ChangeCard, DropCard } from "@/features/review/ChangeCard";
import { CvPage } from "@/features/review/CvPage";
import { Rail } from "@/features/review/Rail";
import { buildCards, counts as countFilters, matchesFilter, textsWithAdds, type ReviewFilter } from "@/features/review/cards";
import { buildCvMarks } from "@/features/review/cvMarks";
import { explainDrop } from "@/features/review/dropCopy";
import { decidedChanges } from "@/features/review/rules";
import { useReview } from "@/features/review/useReview";
import { useReviewShortcuts } from "@/features/review/useReviewShortcuts";
import { ReviewTopBar } from "@/features/review/topbar/ReviewTopBar";
import type { ReviewRun } from "@/features/review/types";

const UNDO_MS = 6000;

const quoted = (value: string) => value.replace(/["\\]/g, "\\$&");
const find = (attribute: string, value: string) => document.querySelector<HTMLElement>(`[${attribute}="${quoted(value)}"]`);
const prefersReducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The Review screen on desktop, "suggesting mode": the top bar, the filter rail, the CV page with the Changes laid over
 * it, and the margin of Change cards. Mount it keyed by the Run, so the Review state is the Run's.
 */
export function ReviewScreen({ run, notice = "" }: { run: ReviewRun; notice?: string }) {
  const review = useReview(run);
  const { state, dispatch } = review;
  const toast = useToast();

  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pickedItem, setPickedItem] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState<string[]>([]);
  const [confirmDrop, setConfirmDrop] = useState<{ itemId: ItemId; requirements: string[] } | null>(null);

  const decided = useMemo(() => decidedChanges(run, state), [run, state]);
  const cards = useMemo(() => buildCards(run, state.drops), [run, state.drops]);
  const marks = useMemo(() => buildCvMarks(run.originalCv, decided, state.drops), [run.originalCv, decided, state.drops]);
  const texts = useMemo(() => textsWithAdds(run.originalCv, run.changes), [run.originalCv, run.changes]);
  const reviewed = useMemo(() => new Set(state.reviewed), [state.reviewed]);
  const decidedById = useMemo(() => new Map(decided.map((c) => [c.id as string, c])), [decided]);

  const visible = useMemo(() => cards.flatMap((card) => (card.kind === "change" && matchesFilter(filter, card.change, reviewed.has(card.change.id)) ? [card.change.id as string] : [])), [cards, filter, reviewed]);
  const dimmed = useMemo(() => {
    const shown = new Set(visible);
    return new Set(run.changes.map((c) => c.id as string).filter((id) => !shown.has(id)));
  }, [visible, run.changes]);

  const selectedId = state.selectedId;
  const selectedItem = selectedId ? marks.itemOfChange(selectedId) : pickedItem;

  // --- toasts with Undo ---
  const undoOptions: ToastOptions = { durationMs: UNDO_MS, action: { label: "Undo", onSelect: () => dispatch({ type: "undo" }) } };

  // --- selection: scroll the card and its mark into view; move focus unless the user clicked a mark ---
  const clickedMark = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    const card = find("data-card-id", selectedId);
    card?.scrollIntoView?.({ block: "nearest", behavior });
    find("data-change-id", selectedId)?.scrollIntoView?.({ block: "center", behavior });
    if (clickedMark.current !== selectedId && card && document.activeElement !== card) card.focus({ preventScroll: true });
    clickedMark.current = null;
  }, [selectedId]);

  const select = (changeId: string | null) => dispatch({ type: "select", changeId });
  const move = (delta: 1 | -1) => {
    if (visible.length === 0) return;
    const at = selectedId ? visible.indexOf(selectedId) : -1;
    const next = at < 0 ? (delta > 0 ? 0 : visible.length - 1) : Math.min(Math.max(at + delta, 0), visible.length - 1);
    select(visible[next]!);
  };

  // --- a decision can give a drop back: tell the user ---
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

  const bulk = (decision: "accept" | "reject") => {
    if (visible.length === 0) return;
    decisionMade.current = true;
    dispatch({ type: "bulk", decision, changeIds: visible });
    toast.show(`${visible.length} ${visible.length === 1 ? "Change" : "Changes"} ${decision === "accept" ? "accepted" : "rejected"}`, undoOptions);
  };

  const save = (changeId: string, value: { after?: string; orderedItemIds?: ItemId[] }) => {
    decisionMade.current = true;
    dispatch({ type: "revise", changeId, ...value });
    setEditingId(null);
    toast.show("Change edited", undoOptions);
  };

  const startEdit = () => {
    const change = selectedId ? decidedById.get(selectedId) : undefined;
    if (change && change.op !== "remove") setEditingId(change.id);
  };

  // --- drops ---
  const doDrop = (itemId: ItemId) => {
    dispatch({ type: "drop", itemId });
    toast.show("Bullet dropped", undoOptions);
  };
  const attemptDrop = (itemId: string) => {
    if (!marks.isBullet(itemId) || !review.canDrop(itemId as ItemId).ok) return;
    const citing = review.citingRequirements(itemId);
    if (citing.length > 0) setConfirmDrop({ itemId: itemId as ItemId, requirements: citing.map((r) => r.text) });
    else doDrop(itemId as ItemId);
  };

  useReviewShortcuts({
    next: () => move(1),
    previous: () => move(-1),
    accept: () => selectedId && decide(selectedId, "accept"),
    reject: () => selectedId && decide(selectedId, "reject"),
    edit: startEdit,
    drop: () => selectedItem && attemptDrop(selectedItem),
    undo: () => {
      if (!review.canUndo) return;
      dispatch({ type: "undo" });
      toast.show("Undone", { durationMs: UNDO_MS });
    },
  });

  const invalid = review.fit.error?.kind === "invalid" ? review.fit.error : null;
  const over = review.fit.fit.fits ? 0 : review.fit.fit.overByLines;

  const itemControls = (itemId: string) => {
    if (!marks.isBullet(itemId) || state.drops.includes(itemId as ItemId)) return null;
    const check = review.canDrop(itemId as ItemId);
    const refusal = check.ok ? null : explainDrop(check.reason);
    const showButton = check.ok || refusal?.kind === "last" || refusal?.kind === "reworded";
    return (
      <div className="flex flex-wrap items-center gap-2 px-1 pb-1.5">
        {showButton && (
          <Button size="compact" variant="secondary" disabled={!check.ok} onClick={() => attemptDrop(itemId)} className="min-h-8 px-3 text-[13px]">
            Drop <Kbd>D</Kbd>
          </Button>
        )}
        {refusal && <p className="text-xs text-fg-2">{refusal.message}</p>}
      </div>
    );
  };

  return (
    <div>
      <ReviewTopBar run={run} review={review} onHighlightChanges={setHighlighted} checklistOpen={checklistOpen} onChecklistOpenChange={setChecklistOpen} />
      {notice && <p className="mx-auto max-w-[1400px] px-6 pt-3 text-sm font-semibold text-fg-2">{notice}</p>}
      <div className="mx-auto grid max-w-[1400px] grid-cols-[220px_minmax(0,1fr)_340px] items-start gap-6 px-6 py-6">
        <div className="sticky top-32">
          <Rail filter={filter} onFilter={setFilter} counts={countFilters(run, state)} requirements={run.requirements} visibleCount={visible.length} onBulk={bulk} onOpenChecklist={() => setChecklistOpen(true)} />
        </div>

        <CvPage
          cv={run.originalCv}
          changes={decided}
          drops={state.drops}
          selectedChangeId={selectedId}
          selectedItemId={selectedItem}
          highlightedChangeIds={highlighted}
          dimmedChangeIds={dimmed}
          onSelectChange={(changeId, itemId) => {
            if (changeId !== selectedId) clickedMark.current = changeId;
            setPickedItem(itemId);
            select(changeId);
          }}
          onSelectItem={(itemId) => {
            setPickedItem(itemId);
            if (selectedId !== null) select(null);
          }}
          itemControls={itemControls}
        />

        <section aria-label="Changes" className="sticky top-32 flex max-h-[calc(100vh-9rem)] flex-col gap-2 overflow-y-auto pb-2">
          {cards.map((card) => {
            if (card.kind === "drop") {
              if (filter !== "all") return null;
              return <DropCard key={`drop-${card.itemId}`} card={card} onUndo={() => dispatch({ type: "undrop", itemId: card.itemId })} />;
            }
            const id = card.change.id as string;
            const isSelected = id === selectedId;
            if (!isSelected && !visible.includes(id)) return null;
            return (
              <ChangeCard
                key={id}
                run={run}
                card={card}
                decision={state.decisions[id]}
                reviewed={reviewed.has(id)}
                selected={isSelected}
                editing={isSelected && editingId === id}
                error={invalid?.changeId === id ? invalid.message : null}
                highlighted={highlighted.includes(id)}
                texts={texts}
                onSelect={() => select(id)}
                onDecide={(decision) => decide(id, decision)}
                onEdit={startEdit}
                onCancelEdit={() => setEditingId(null)}
                onSave={(value) => save(id, value)}
              />
            );
          })}
          {over > 0 && (
            <p className="rounded-tile border border-dashed border-fg-3 p-3 text-[13px] text-fg-2">
              Still {over} {over === 1 ? "line" : "lines"} over. Reject an addition, or select any bullet in your CV and press D to drop it.
            </p>
          )}
        </section>
      </div>

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
