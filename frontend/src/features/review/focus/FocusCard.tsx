import { useState, type PointerEvent } from "react";
import { Eye } from "lucide-react";
import type { Change, ItemId } from "@resume-ai/shared";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { cx } from "@/ui/cx";
import { OrderEditor, TextEditor, evidenceOf } from "@/features/review/ChangeCard";
import { TYPE_LABEL, previewOf, statusWord, type Card } from "@/features/review/cards";
import type { ChangeDecision, ReviewRun } from "@/features/review/types";

type ChangeEntry = Extract<Card, { kind: "change" }>;

/** The plain-language question that titles a focus card (review.md). */
export const QUESTION: Record<Change["op"], string> = {
  replace: "Use this rewording?",
  add: "Add this bullet?",
  remove: "Remove this bullet to fit one page?",
  reorder: "Use this new order?",
};

const SWIPE_PX = 64;
const NO_SWIPE = "input, textarea, select, [contenteditable='true'], [data-no-swipe]";

export interface FocusCardProps {
  run: ReviewRun;
  card: ChangeEntry;
  decision: ChangeDecision | undefined;
  reviewed: boolean;
  /** The server's message when this Change is the one an `INVALID_REVIEW` named. */
  error: string | null;
  texts: Map<string, string>;
  onSave: (value: { after?: string; orderedItemIds?: ItemId[] }) => void;
  onShowInCv: () => void;
  /** Swipe left (next) and right (previous): an extra, every one has a button. */
  onSwipe: (delta: 1 | -1) => void;
  edit: { editing: boolean; setEditing: (editing: boolean) => void };
}

/** One Change, full width: the question, the diff, why, "Based on", Edit and "Show it in the CV". */
export function FocusCard({ run, card, decision, reviewed, error, texts, onSave, onShowInCv, onSwipe, edit }: FocusCardProps) {
  const { change } = card;
  const { editing, setEditing } = edit;
  const preview = previewOf(change, decision, texts);
  const evidence = evidenceOf(run, change);
  const requirements = run.requirements.filter((r) => change.requirementIds.includes(r.id));
  const edited = decision?.decision === "revise";
  const label = `Change ${card.number} of ${card.total}, ${TYPE_LABEL[change.op].toLowerCase()}, ${card.section}`;

  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const down = (e: PointerEvent) => {
    if (editing || (e.target instanceof Element && e.target.closest(NO_SWIPE))) return setStart(null);
    setStart({ x: e.clientX, y: e.clientY });
  };
  const up = (e: PointerEvent) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    setStart(null);
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) >= 2 * Math.abs(dy)) onSwipe(dx < 0 ? 1 : -1);
  };

  return (
    <div
      role="group"
      aria-label={label}
      data-card-id={change.id}
      tabIndex={-1}
      style={{ touchAction: "pan-y" }}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={() => setStart(null)}
      className="flex flex-col gap-3 rounded-tile bg-surface p-4 ring-1 ring-line outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-center justify-between gap-2">
        <Chip variant="badge">{TYPE_LABEL[change.op]}</Chip>
        <span className="text-xs text-fg-3">
          {card.section} · {card.number} of {card.total}
        </span>
      </div>
      <h2 className="text-xl leading-snug font-bold tracking-tight">{QUESTION[change.op]}</h2>

      <div className="rounded-sm bg-soft p-3 text-[15px]">
        {change.op === "replace" && (
          <p>
            <del className="text-fg-3 line-through decoration-del">
              <span className="sr-only">Removed: </span>
              {change.before}
            </del>{" "}
            <ins className="text-ok underline decoration-2 decoration-ok underline-offset-[3px]">
              <span className="sr-only">Added: </span>
              {preview}
            </ins>
          </p>
        )}
        {change.op === "add" && (
          <p>
            <ins className="text-ok underline decoration-2 decoration-ok underline-offset-[3px]">
              <span className="sr-only">Added: </span>
              {preview}
            </ins>
          </p>
        )}
        {change.op === "remove" && (
          <p>
            <del className="text-fg-3 line-through decoration-del">
              <span className="sr-only">Removed: </span>
              {change.before}
            </del>
          </p>
        )}
        {change.op === "reorder" && (
          <p>
            <span className="font-semibold">New order: </span>
            {preview}
          </p>
        )}
      </div>

      <p className={cx("text-xs font-semibold", edited ? "text-accent-fg" : "text-fg-3")}>{statusWord(reviewed, decision?.decision)}</p>
      {edited && change.op !== "reorder" && <p className="text-[13px] text-accent-fg">In your words: goes into the CV exactly as written.</p>}

      {change.rationale && <p className="text-[14px]">{change.rationale}</p>}

      {evidence.length > 0 && (
        <div className="rounded-sm bg-soft p-2.5">
          <p className="mb-1 text-[11px] font-bold tracking-[0.08em] text-fg-3 uppercase">Based on</p>
          <ul className="flex flex-col gap-2">
            {evidence.map((e) => (
              <li key={e.id}>
                <blockquote className="text-[13px] text-fg">“{e.text}”</blockquote>
                <p className="text-xs text-fg-3">{e.source}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {requirements.length > 0 && (
        <ul aria-label="Requirements it targets" className="flex flex-wrap gap-1.5">
          {requirements.map((r) => (
            <li key={r.id} className="rounded-full px-2 py-0.5 text-xs font-semibold text-fg-2 ring-1 ring-fg-3">
              {r.text}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-[13px] font-semibold text-danger">{error}</p>}

      {editing && change.op === "reorder" ? (
        <OrderEditor
          ids={(decision?.orderedItemIds ?? change.orderedItemIds) as ItemId[]}
          texts={texts}
          onSave={(orderedItemIds) => onSave({ orderedItemIds })}
          onCancel={() => setEditing(false)}
        />
      ) : editing && change.op !== "remove" ? (
        <TextEditor initial={preview} onSave={(after) => onSave({ after })} onCancel={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {change.op !== "remove" && (
            <Button size="compact" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <Button size="compact" variant="ghost" onClick={onShowInCv}>
            <Eye aria-hidden="true" size={16} strokeWidth={2} />
            Show it in the CV
          </Button>
        </div>
      )}
    </div>
  );
}
