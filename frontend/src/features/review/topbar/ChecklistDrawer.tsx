import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, X } from "lucide-react";
import { itemTexts, type RequirementCoverageSummary } from "@resume-ai/shared";
import type { ReviewRun, UseReview } from "@/features/review";
import { Chip } from "@/ui/Chip";
import { cx } from "@/ui/cx";

const VERDICT = {
  met: { word: "met", tone: "text-ok" },
  partially_met: { word: "partially met", tone: "text-warn-fg" },
  unmet: { word: "unmet", tone: "text-danger" },
} as const;

function Verdict({ verdict }: { verdict: keyof typeof VERDICT }) {
  return <span className={cx("font-semibold", VERDICT[verdict].tone)}>{VERDICT[verdict].word}</span>;
}

interface RowProps {
  requirement: RequirementCoverageSummary;
  mayChange: boolean;
  evidence: { id: string; text: string }[];
  onHighlight: (changeIds: string[]) => void;
  citing: string[];
}

function Row({ requirement: r, mayChange, evidence, onHighlight, citing }: RowProps) {
  const [open, setOpen] = useState(false);
  const panelId = `req-${r.id}-detail`;
  return (
    <li
      className="rounded-tile bg-surface p-3 ring-1 ring-line"
      onMouseEnter={() => onHighlight(citing)}
      onMouseLeave={() => onHighlight([])}
      onFocus={() => onHighlight(citing)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onHighlight([]);
      }}
    >
      <p className="text-[15px] font-semibold">{r.text}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
        <span className="sr-only">Verdict before:</span>
        <Verdict verdict={r.before} />
        <span aria-hidden="true">→</span>
        <span className="sr-only">after:</span>
        <Verdict verdict={r.after.verdict} />
        {r.confirmedGap && <Chip variant="badge">Confirmed Gap</Chip>}
        {mayChange && <Chip variant="warn">May change</Chip>}
      </p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="mt-2 inline-flex min-h-8 items-center gap-1 text-[13px] font-semibold text-accent"
      >
        <ChevronDown aria-hidden="true" size={14} strokeWidth={2} className={cx("transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} />
        Why this verdict
      </button>
      {open && (
        <div id={panelId} className="mt-1 flex flex-col gap-2 text-[13px] text-fg-2">
          <p>{r.after.reason}</p>
          {evidence.length > 0 && (
            <div>
              <p className="font-semibold text-fg">Evidence</p>
              <ul className="mt-1 flex flex-col gap-1">
                {evidence.map((e) => (
                  <li key={e.id} className="rounded-sm bg-soft px-2 py-1">
                    &ldquo;{e.text}&rdquo;
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export interface ChecklistDrawerProps {
  run: ReviewRun;
  mayChange: UseReview["mayChange"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHighlightChanges: (changeIds: string[]) => void;
  /** Show it as a modal bottom sheet (phone focus mode) instead of a right-hand drawer. */
  sheet?: boolean;
}

/**
 * The Requirement checklist, as a right-hand drawer: must-haves first, then nice-to-haves. It is not modal and has no
 * overlay, so the highlighted Changes stay visible on the page behind it.
 */
export function ChecklistDrawer({ run, mayChange, open, onOpenChange, onHighlightChanges, sheet = false }: ChecklistDrawerProps) {
  const texts = useMemo(() => {
    const map = new Map([...itemTexts(run.originalCv), ...itemTexts(run.cv)]);
    for (const e of run.userEvidence) map.set(e.id, e.text);
    return map;
  }, [run]);
  const citing = (requirementId: string) => run.changes.filter((c) => c.requirementIds.some((id) => id === requirementId)).map((c) => c.id as string);
  const groups = [
    { label: "Must-have", items: run.requirements.filter((r) => r.importance === "must_have") },
    { label: "Nice-to-have", items: run.requirements.filter((r) => r.importance !== "must_have") },
  ];

  return (
    <Dialog.Root
      modal={sheet}
      open={open}
      onOpenChange={(next) => {
        if (!next) onHighlightChanges([]);
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        {sheet && <Dialog.Overlay className="fixed inset-0 z-40 bg-fg/40" />}
        <Dialog.Content
          onInteractOutside={sheet ? undefined : (e) => e.preventDefault()}
          className={
            sheet
              ? "fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col gap-4 overflow-y-auto rounded-t-hero bg-bg p-5 pb-8 shadow-xl"
              : "fixed inset-y-0 right-0 z-40 flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-4 overflow-y-auto bg-bg p-5 shadow-xl ring-1 ring-line"
          }
        >
          <div className="flex items-start justify-between gap-2">
            <Dialog.Title className="text-xl font-bold tracking-tight">Requirement checklist</Dialog.Title>
            <Dialog.Close aria-label="Close checklist" className="inline-flex size-10 items-center justify-center rounded-btn text-fg-2 hover:bg-soft">
              <X aria-hidden="true" size={18} strokeWidth={2} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-[13px] text-fg-2">As proposed. The final score is recalculated from your decisions when you submit.</Dialog.Description>
          {groups.map(
            ({ label, items }) =>
              items.length > 0 && (
                <section key={label} aria-label={label} className="flex flex-col gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-fg-3">{label}</h3>
                  <ul className="flex flex-col gap-2">
                    {items.map((r) => (
                      <Row
                        key={r.id}
                        requirement={r}
                        mayChange={mayChange.has(r.id)}
                        evidence={r.after.evidenceIds.flatMap((id) => (texts.has(id) ? [{ id, text: texts.get(id)! }] : []))}
                        citing={citing(r.id)}
                        onHighlight={onHighlightChanges}
                      />
                    ))}
                  </ul>
                </section>
              ),
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
