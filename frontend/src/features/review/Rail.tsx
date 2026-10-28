import { Menu } from "@/ui/Menu";
import { Kbd } from "@/ui/Kbd";
import { cx } from "@/ui/cx";
import { ShortcutsToggle } from "@/features/shortcuts/ShortcutsToggle";
import { FILTERS, type ReviewFilter } from "@/features/review/cards";
import type { ReviewRun } from "@/features/review/types";

export interface RailProps {
  filter: ReviewFilter;
  onFilter: (filter: ReviewFilter) => void;
  counts: Record<ReviewFilter, number>;
  requirements: ReviewRun["requirements"];
  /** How many Changes the current filter shows (what a bulk action applies to). */
  visibleCount: number;
  onBulk: (decision: "accept" | "reject") => void;
  /** Opens the checklist drawer, which the screen owns. */
  onOpenChecklist: () => void;
}

function Eyebrow({ children }: { children: string }) {
  return <h2 className="mb-2 text-[11px] font-bold tracking-[0.1em] text-fg-3 uppercase">{children}</h2>;
}

const LEGEND: [keys: string[], text: string][] = [
  [["J", "K"], "next and previous"],
  [["A"], "accept"],
  [["R"], "reject"],
  [["E"], "edit"],
  [["D"], "drops the selected bullet"],
  [["⌘ Z"], "undo"],
];

/** The left rail: the "Show" filter list with bulk actions, the Requirements summary and the keyboard legend. */
export function Rail({ filter, onFilter, counts, requirements, visibleCount, onBulk, onOpenChecklist }: RailProps) {
  const mustHaves = requirements.filter((r) => r.importance === "must_have");
  const met = mustHaves.filter((r) => r.after.verdict === "met").length;
  return (
    <aside aria-label="Filters and shortcuts" className="flex flex-col gap-6 text-[13px]">
      <section>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-[11px] font-bold tracking-[0.1em] text-fg-3 uppercase">Show</h2>
          <Menu
            label="Bulk actions for this filter"
            items={[
              { label: `Accept all (${visibleCount})`, onSelect: () => onBulk("accept") },
              { label: `Reject all (${visibleCount})`, onSelect: () => onBulk("reject") },
            ]}
          />
        </div>
        <ul className="flex flex-col gap-0.5">
          {FILTERS.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onFilter(f.id)}
                aria-pressed={filter === f.id}
                className={cx("flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left font-semibold", filter === f.id ? "bg-accent-soft text-accent-fg" : "text-fg-2 hover:bg-soft")}
              >
                {f.label}
                <span className="tabular-nums">{counts[f.id]}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <Eyebrow>Requirements</Eyebrow>
        <p className="font-semibold">
          {met} of {mustHaves.length} must-haves met
        </p>
        <div aria-hidden="true" className="my-2 flex h-1.5 gap-0.5">
          {mustHaves.map((r) => (
            <span key={r.id} className={cx("h-full flex-1 rounded-full", r.after.verdict === "met" ? "bg-ok" : r.after.verdict === "partially_met" ? "bg-warn-line" : "bg-del")} />
          ))}
        </div>
        <button type="button" onClick={onOpenChecklist} className="font-semibold text-accent underline">
          Open checklist
        </button>
      </section>

      <section>
        <Eyebrow>Keyboard</Eyebrow>
        <dl className="flex flex-col gap-1.5">
          {LEGEND.map(([keys, text]) => (
            <div key={text} className="flex items-center gap-2">
              <dt className="flex shrink-0 gap-1">
                {keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </dt>
              <dd className="text-fg-2">{text}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-3">
          <ShortcutsToggle />
        </div>
      </section>
    </aside>
  );
}
