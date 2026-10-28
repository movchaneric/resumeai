import { useState } from "react";
import { Check, Circle, CircleDot, Pencil, Undo2, X } from "lucide-react";
import { itemTexts } from "@resume-ai/shared";
import type { Change, ItemId } from "@resume-ai/shared";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Field } from "@/ui/Field";
import { Kbd } from "@/ui/Kbd";
import { cx } from "@/ui/cx";
import { TYPE_LABEL, previewOf, statusWord, type Card } from "@/features/review/cards";
import { locate } from "@/features/review/locate";
import type { ChangeDecision, ReviewRun } from "@/features/review/types";

type ChangeEntry = Extract<Card, { kind: "change" }>;
type DropEntry = Extract<Card, { kind: "drop" }>;

const STATUS_ICON = { Accepted: Check, Rejected: X, Edited: Pencil, "To review": Circle } as const;
const STATUS_TONE = { Accepted: "text-ok", Rejected: "text-danger", Edited: "text-accent", "To review": "text-fg-3" } as const;

/** Who said it: a quote from the CV with its source, or from an Answer. */
export function evidenceOf(run: Pick<ReviewRun, "originalCv" | "userEvidence" | "requirements">, change: Change): { id: string; text: string; source: string }[] {
  const texts = itemTexts(run.originalCv);
  const out: { id: string; text: string; source: string }[] = [];
  for (const id of change.evidenceIds) {
    const answer = run.userEvidence.find((u) => u.id === id);
    if (answer) {
      const requirement = run.requirements.find((r) => r.id === answer.requirementId);
      out.push({ id, text: answer.text, source: requirement ? `Your answer about ${requirement.text}` : "Your answer" });
      continue;
    }
    const text = texts.get(id);
    if (text) {
      const place = locate(run.originalCv, id);
      out.push({ id, text, source: `Your CV · ${place.entry ?? place.section}` });
    }
  }
  return out;
}

function StatusLine({ word }: { word: keyof typeof STATUS_ICON }) {
  const Icon = STATUS_ICON[word];
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 text-xs font-semibold", STATUS_TONE[word])}>
      <Icon aria-hidden="true" size={14} strokeWidth={2.25} />
      {word}
    </span>
  );
}

const CARD = "rounded-tile bg-surface ring-1 ring-line";

function DecisionButton({ active, activeLabel, label, tone, icon: Icon, hint, onClick }: { active: boolean; activeLabel: string; label: string; tone: string; icon: typeof Check; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "flex min-h-10 w-full items-center justify-center gap-2 rounded-btn text-[14px] font-semibold transition-colors duration-150",
        active ? `${tone} text-surface` : "bg-surface text-fg ring-1 ring-fg-3 hover:bg-soft",
      )}
    >
      {active && <Icon aria-hidden="true" size={16} strokeWidth={2.5} />}
      {active ? activeLabel : label}
      <Kbd className={active ? "bg-surface/20 text-surface border-surface/40" : undefined}>{hint}</Kbd>
    </button>
  );
}

export function TextEditor({ initial, onSave, onCancel }: { initial: string; onSave: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial);
  const save = () => text.trim() && onSave(text);
  return (
    <div className="flex flex-col gap-2">
      <Field
        autoFocus
        multiline
        label="Your wording"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel();
          }
        }}
        helper="It goes into the CV exactly as written."
      />
      <div className="flex gap-2">
        <Button size="compact" disabled={!text.trim()} onClick={save}>
          Save <Kbd className="bg-surface/20 text-surface border-surface/40">⌘ Enter</Kbd>
        </Button>
        <Button size="compact" variant="secondary" onClick={onCancel}>
          Cancel <Kbd>Esc</Kbd>
        </Button>
      </div>
    </div>
  );
}

export function OrderEditor({ ids, texts, onSave, onCancel }: { ids: ItemId[]; texts: Map<string, string>; onSave: (ids: ItemId[]) => void; onCancel: () => void }) {
  const [order, setOrder] = useState(ids);
  const move = (index: number, by: -1 | 1) =>
    setOrder((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(index + by, 0, item!);
      return next;
    });
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">New order</p>
      <ol className="flex flex-col gap-1">
        {order.map((id, index) => {
          const name = texts.get(id) ?? id;
          return (
            <li key={id} className="flex items-center gap-2 rounded-sm bg-soft px-2 py-1 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move up: ${name}`} className="rounded-sm px-1.5 text-xs font-semibold text-accent disabled:opacity-40">
                Move up
              </button>
              <button type="button" disabled={index === order.length - 1} onClick={() => move(index, 1)} aria-label={`Move down: ${name}`} className="rounded-sm px-1.5 text-xs font-semibold text-accent disabled:opacity-40">
                Move down
              </button>
            </li>
          );
        })}
      </ol>
      <div className="flex gap-2">
        <Button size="compact" onClick={() => onSave(order)}>
          Save
        </Button>
        <Button size="compact" variant="secondary" onClick={onCancel}>
          Cancel <Kbd>Esc</Kbd>
        </Button>
      </div>
    </div>
  );
}

export interface ChangeCardProps {
  run: ReviewRun;
  card: ChangeEntry;
  decision: ChangeDecision | undefined;
  reviewed: boolean;
  selected: boolean;
  editing: boolean;
  /** The server's message when this Change is the one an `INVALID_REVIEW` named. */
  error: string | null;
  highlighted: boolean;
  dimmed?: boolean;
  /** The text of every Item, including added ones, to name the Items of a reorder. */
  texts: Map<string, string>;
  onSelect: () => void;
  onDecide: (decision: "accept" | "reject") => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onSave: (value: { after?: string; orderedItemIds?: ItemId[] }) => void;
}

/** One Change in the margin: a line when collapsed, the whole story with Accept, Reject and Edit when selected. */
export function ChangeCard({ run, card, decision, reviewed, selected, editing, error, highlighted, texts, onSelect, onDecide, onEdit, onCancelEdit, onSave }: ChangeCardProps) {
  const { change } = card;
  const word = statusWord(reviewed, decision?.decision);
  const where = card.entry ?? card.section;
  const label = `Change ${card.number} of ${card.total}, ${TYPE_LABEL[change.op].toLowerCase()}, ${card.section}`;
  const preview = previewOf(change, decision, texts);
  const evidence = selected ? evidenceOf(run, change) : [];
  const requirements = run.requirements.filter((r) => change.requirementIds.includes(r.id));
  const edited = decision?.decision === "revise";

  if (!selected) {
    return (
      <div role="group" aria-label={label} data-card-id={change.id} tabIndex={-1} className={cx(CARD, "outline-none", highlighted && "ring-2 ring-accent")}>
        <button type="button" onClick={onSelect} aria-expanded={false} className="flex w-full flex-col gap-0.5 rounded-tile px-3 py-2 text-left">
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold">
              <CircleDot aria-hidden="true" size={14} className="text-fg-3" />
              {TYPE_LABEL[change.op]} · {where}
            </span>
            <StatusLine word={word} />
          </span>
          <span className="truncate text-[13px] text-fg-2">{preview}</span>
        </button>
      </div>
    );
  }

  return (
    <div role="group" aria-label={label} data-card-id={change.id} tabIndex={-1} className={cx(CARD, "flex flex-col gap-3 p-3 outline-none ring-2 ring-accent")}>
      <div className="flex items-center justify-between gap-2">
        <Chip variant="badge">{TYPE_LABEL[change.op]}</Chip>
        <span className="text-xs text-fg-3">
          {card.section} · {card.number} of {card.total}
        </span>
      </div>
      {change.op === "remove" ? <p className="text-[13px] text-fg-2 line-through decoration-del">{change.before}</p> : <p className="text-[13px] text-fg-2">{preview}</p>}
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
        <OrderEditor ids={(decision?.orderedItemIds ?? change.orderedItemIds) as ItemId[]} texts={texts} onSave={(orderedItemIds) => onSave({ orderedItemIds })} onCancel={onCancelEdit} />
      ) : editing && change.op !== "remove" ? (
        <TextEditor initial={preview} onSave={(after) => onSave({ after })} onCancel={onCancelEdit} />
      ) : (
        <>
          {edited && change.op !== "reorder" && <p className="text-[13px] text-accent-fg">In your words: goes into the CV exactly as written.</p>}
          <div className="flex flex-col gap-2">
            <DecisionButton active={decision?.decision === "accept"} activeLabel="Accepted" label="Accept" tone="bg-ok" icon={Check} hint="A" onClick={() => onDecide("accept")} />
            <DecisionButton active={decision?.decision === "reject"} activeLabel="Rejected" label="Reject" tone="bg-danger" icon={X} hint="R" onClick={() => onDecide("reject")} />
            {change.op !== "remove" && <DecisionButton active={edited} activeLabel="Edited" label="Edit" tone="bg-accent" icon={Pencil} hint="E" onClick={onEdit} />}
          </div>
        </>
      )}
    </div>
  );
}

/** A bullet the user dropped: "Dropped by you · Fieldstone", with Undo. */
export function DropCard({ card, onUndo }: { card: DropEntry; onUndo: () => void }) {
  return (
    <div role="group" aria-label={`Dropped by you, ${card.entry ?? card.section}`} data-drop-id={card.itemId} className={cx(CARD, "flex items-center gap-2 px-3 py-2")}>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] font-semibold">Dropped by you · {card.entry ?? card.section}</span>
        <span className="truncate text-[13px] text-fg-3 line-through decoration-del">{card.text}</span>
      </div>
      <button type="button" onClick={onUndo} className="inline-flex shrink-0 items-center gap-1 rounded-sm px-2 py-1 text-[13px] font-semibold text-accent hover:bg-accent-soft">
        <Undo2 aria-hidden="true" size={14} />
        Undo
      </button>
    </div>
  );
}
