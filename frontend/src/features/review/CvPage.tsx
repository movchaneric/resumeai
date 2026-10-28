import { useMemo, type ReactNode } from "react";
import type { Change, Cv, ItemId } from "@resume-ai/shared";
import { buildCvMarks, type CvMarks, type ItemMark } from "@/features/review/cvMarks";
import { cx } from "@/ui/cx";

export interface CvPageProps {
  /** The ORIGINAL CV (`originalCv`); the Changes are laid over it. */
  cv: Cv;
  /** The Changes with their decision as `status`. Read-only mode draws only the kept ones (`accepted`, `revised`). */
  changes: Change[];
  /** Bullets the user dropped. */
  drops?: ItemId[];
  /** Kept Changes' marks only: no buttons, no selection, no controls. Used by Done's "See what changed". */
  readOnly?: boolean;
  selectedChangeId?: string | null;
  /** The bullet selected for dropping (click or Tab to it). */
  selectedItemId?: string | null;
  /** Changes to outline (hovered Requirement in the checklist drawer). */
  highlightedChangeIds?: string[];
  /** Changes the filter excludes: their marks are dimmed. */
  dimmedChangeIds?: ReadonlySet<string>;
  onSelectChange?: (changeId: string, itemId: string | null) => void;
  onSelectItem?: (itemId: string) => void;
  /** Controls drawn under the selected bullet (Drop and its refusal). */
  itemControls?: (itemId: string) => ReactNode;
}

const DASH = "–";

function dates(range: { start: string | null; end: string | null; current: boolean } | null): string | null {
  if (!range || (!range.start && !range.end && !range.current)) return null;
  return [range.start, range.current ? "Present" : range.end].filter(Boolean).join(` ${DASH} `);
}

const MARK_DEL = "text-fg-3 line-through decoration-del";
const MARK_INS = "text-ok underline decoration-2 decoration-ok underline-offset-[3px]";

function Hidden({ children }: { children: string }) {
  return <span className="sr-only">{children}</span>;
}

/** The words of one Item with its marks, and text equivalents for them. */
function MarkContent({ mark }: { mark: ItemMark }) {
  switch (mark.kind) {
    case "replaced":
      return (
        <>
          <del className={MARK_DEL}>
            <Hidden>Removed: </Hidden>
            {mark.before}
          </del>{" "}
          <ins className={MARK_INS}>
            <Hidden>Added: </Hidden>
            {mark.text}
          </ins>
        </>
      );
    case "added":
      return (
        <ins className={MARK_INS}>
          <Hidden>Added: </Hidden>
          {mark.text}
        </ins>
      );
    case "removed":
    case "dropped":
      return (
        <del className={MARK_DEL}>
          <Hidden>{mark.kind === "dropped" ? "Dropped by you: " : "Removed: "}</Hidden>
          {mark.text}
        </del>
      );
    case "skipped":
      return (
        <span className="text-fg-3 italic">
          <Hidden>Not added: </Hidden>
          {mark.text}
        </span>
      );
    case "plain":
      return <>{mark.text}</>;
  }
}

interface Ctx extends Pick<CvPageProps, "selectedChangeId" | "selectedItemId" | "onSelectChange" | "onSelectItem" | "itemControls"> {
  readOnly: boolean;
  marks: CvMarks;
  highlighted: ReadonlySet<string>;
  dimmed: ReadonlySet<string>;
}

function Row({ mark, ctx, bullet }: { mark: ItemMark; ctx: Ctx; bullet?: boolean }) {
  const { readOnly } = ctx;
  const changeId = readOnly ? undefined : mark.changeId;
  const selected = !readOnly && ((changeId !== undefined && changeId === ctx.selectedChangeId) || ctx.selectedItemId === mark.id);
  const highlighted = changeId !== undefined && ctx.highlighted.has(changeId);
  const dimmed = changeId !== undefined && ctx.dimmed.has(changeId);
  const selectable = !readOnly && (changeId !== undefined || bullet === true);
  const content = <MarkContent mark={mark} />;
  const select = () => {
    if (changeId !== undefined) ctx.onSelectChange?.(changeId, mark.id);
    else ctx.onSelectItem?.(mark.id);
  };
  return (
    <li
      data-item-id={mark.id}
      data-change-id={changeId}
      className={cx(
        "rounded-sm transition-opacity duration-150",
        bullet && "ml-5 list-disc",
        selected && "bg-accent-soft",
        highlighted && "ring-2 ring-accent",
        dimmed && "opacity-40",
      )}
    >
      {selectable ? (
        <button type="button" onClick={select} onFocus={() => (changeId === undefined ? ctx.onSelectItem?.(mark.id) : undefined)} aria-current={selected || undefined} className="w-full rounded-sm px-1 py-0.5 text-left">
          {content}
        </button>
      ) : (
        <span className="block px-1 py-0.5">{content}</span>
      )}
      {selected && ctx.itemControls?.(mark.id)}
    </li>
  );
}

function Rows({ parentId, ctx, kind }: { parentId: string; ctx: Ctx; kind: "bullets" | "skills" | "items" }) {
  const { items, reorder } = ctx.marks.list(parentId);
  const reorderId = !ctx.readOnly && reorder ? reorder.changeId : undefined;
  const selected = reorderId !== undefined && reorderId === ctx.selectedChangeId;
  const highlighted = reorderId !== undefined && ctx.highlighted.has(reorderId);
  const dimmed = reorderId !== undefined && ctx.dimmed.has(reorderId);
  const visible = ctx.readOnly ? items.filter((m) => m.kind !== "skipped") : items;
  if (visible.length === 0 && !reorder) return null;
  const caption = reorder && (ctx.readOnly ? reorder.kept : true) ? reorder : undefined;
  return (
    <div data-change-id={reorderId} className={cx("rounded-sm", selected && "bg-accent-soft", highlighted && "ring-2 ring-accent", dimmed && "opacity-40")}>
      <ul className={cx(kind === "skills" ? "flex flex-wrap gap-x-4 gap-y-0.5" : "flex flex-col gap-0.5")}>
        {visible.map((mark) => (
          <Row key={mark.id} mark={mark} ctx={ctx} bullet={kind === "bullets"} />
        ))}
      </ul>
      {caption &&
        (ctx.readOnly ? (
          <p className="mt-1 px-1 text-xs text-fg-3">Original order: {caption.originalOrder.join(", ")}</p>
        ) : (
          <button type="button" onClick={() => ctx.onSelectChange?.(caption.changeId, null)} className="mt-1 block w-full rounded-sm px-1 text-left text-xs text-fg-3">
            {caption.kept ? `Reordered. Original order: ${caption.originalOrder.join(", ")}` : "Reordering not applied"}
          </button>
        ))}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <h2 className="mb-2 border-b border-line pb-1 text-[11px] font-bold tracking-[0.1em] text-fg-3 uppercase">{children}</h2>;
}

function EntryHead({ title, meta }: { title: string; meta: (string | null)[] }) {
  const line = meta.filter(Boolean).join(" · ");
  return (
    <div className="mt-3 first:mt-0">
      <h3 className="text-[15px] leading-snug font-semibold tracking-normal">{title}</h3>
      {line && <p className="text-[13px] text-fg-2">{line}</p>}
    </div>
  );
}

/**
 * The CV as a document, drawn from the original CV with every Change laid over it: struck text for what goes, underlined
 * new text for what comes in, the new order of a reordered list with "Original order". With `readOnly` it shows only the
 * kept Changes' marks and has no controls.
 */
export function CvPage({ cv, changes, drops = [], readOnly = false, selectedChangeId = null, selectedItemId = null, highlightedChangeIds = [], dimmedChangeIds, onSelectChange, onSelectItem, itemControls }: CvPageProps) {
  const marks = useMemo(() => buildCvMarks(cv, changes, drops, { includeSkipped: !readOnly }), [cv, changes, drops, readOnly]);
  const highlighted = useMemo(() => new Set(highlightedChangeIds), [highlightedChangeIds]);
  const ctx: Ctx = { readOnly, marks, highlighted, dimmed: dimmedChangeIds ?? new Set(), selectedChangeId, selectedItemId, onSelectChange, onSelectItem, itemControls };
  const { contact } = cv;
  const contactLine = [contact.email, contact.phone, contact.location, ...contact.links.map((l) => l.label ?? l.url)].filter(Boolean).join(" · ");
  const summary = cv.summary ? marks.item(cv.summary.id) : undefined;

  return (
    <article aria-label="Your CV" className="rounded-hero bg-surface px-8 py-10 text-[14px] leading-relaxed shadow-lg ring-1 ring-line lg:px-14">
      <header className="mb-5">
        <h2 className="text-[26px] leading-tight font-bold">{contact.name}</h2>
        {contact.headline && <p className="text-[15px] text-fg-2">{contact.headline}</p>}
        {contactLine && <p className="text-[13px] text-fg-3">{contactLine}</p>}
      </header>

      {summary && (
        <section className="mb-5">
          <Eyebrow>Summary</Eyebrow>
          <ul>
            <Row mark={summary} ctx={ctx} />
          </ul>
        </section>
      )}

      {cv.experience.length > 0 && (
        <section className="mb-5">
          <Eyebrow>Experience</Eyebrow>
          {cv.experience.map((job) => (
            <div key={job.id}>
              <EntryHead title={`${job.title}, ${job.company}`} meta={[job.location, dates(job.dates)]} />
              <Rows parentId={job.id} ctx={ctx} kind="bullets" />
            </div>
          ))}
        </section>
      )}

      {cv.projects.length > 0 && (
        <section className="mb-5">
          <Eyebrow>Projects</Eyebrow>
          {cv.projects.map((project) => (
            <div key={project.id}>
              <EntryHead title={project.name} meta={[project.url, dates(project.dates)]} />
              <Rows parentId={project.id} ctx={ctx} kind="bullets" />
            </div>
          ))}
        </section>
      )}

      {cv.education.length > 0 && (
        <section className="mb-5">
          <Eyebrow>Education</Eyebrow>
          {cv.education.map((school) => (
            <div key={school.id}>
              <EntryHead title={school.institution} meta={[[school.degree, school.field].filter(Boolean).join(", ") || null, dates(school.dates)]} />
              <Rows parentId={school.id} ctx={ctx} kind="bullets" />
            </div>
          ))}
        </section>
      )}

      {(cv.skills.length > 0 || marks.list("skills").items.length > 0) && (
        <section className="mb-5">
          <Eyebrow>Skills</Eyebrow>
          <Rows parentId="skills" ctx={ctx} kind="skills" />
        </section>
      )}

      {cv.certifications.length > 0 && (
        <section className="mb-5">
          <Eyebrow>Certifications</Eyebrow>
          <ul className="flex flex-col gap-0.5">
            {cv.certifications.map((c) => (
              <li key={c.id} className="px-1 py-0.5">
                {[c.name, c.issuer, c.date].filter(Boolean).join(" · ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      {cv.additionalSections.map((section) => (
        <section key={section.id} className="mb-5">
          <Eyebrow>{section.title}</Eyebrow>
          <Rows parentId={section.id} ctx={ctx} kind="items" />
        </section>
      ))}
    </article>
  );
}
