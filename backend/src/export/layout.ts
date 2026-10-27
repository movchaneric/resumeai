import type { Cv, DateRange, PartialDate } from "@resume-ai/shared";

/*
 * CV -> page blocks. Pure: no fonts, no sizes, no file format. The PDF renderer draws these blocks and
 * the DOCX renderer builds paragraphs from the same list, so both show the same content in the same order.
 */

/** A piece of text with its emphasis. */
export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type Block =
  | { kind: "name"; text: string }
  | { kind: "headline"; text: string }
  | { kind: "contact"; label: string | null; value: string }
  | { kind: "heading"; text: string }
  /** A job, project, degree or certification: `left` at the start of the line, `right` (dates, URL) at the end. */
  | { kind: "entry"; left: TextSpan[]; right: string | null }
  /** A plain italic line under an entry (a project's dates). */
  | { kind: "note"; text: string }
  | { kind: "bullet"; text: string }
  /** A skills line or an additional-section item: no bullet. */
  | { kind: "line"; text: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DASH = "–";
const EM_DASH = "—";

/** "2021-03" -> "Mar 2021"; a bare year stays as given. */
export function formatPartialDate(date: PartialDate): string {
  const [year, month] = date.split("-");
  return month === undefined ? year! : `${MONTHS[Number(month) - 1]} ${year}`;
}

/** "Jun 2017 – Feb 2020", "2024 – Present"; an open start shows the end alone; null when there is nothing to show. */
export function formatDateRange(range: DateRange): string | null {
  const end = range.current ? "Present" : range.end === null ? null : formatPartialDate(range.end);
  if (range.start === null) return end;
  const start = formatPartialDate(range.start);
  return end === null ? start : `${start} ${DASH} ${end}`;
}

const filled = (value: string | null | undefined): value is string => value !== null && value !== undefined && value.trim() !== "";

function headerBlocks(contact: Cv["contact"]): Block[] {
  const blocks: Block[] = [{ kind: "name", text: contact.name }];
  if (filled(contact.headline)) blocks.push({ kind: "headline", text: contact.headline });
  const lines: [string, string | null][] = [
    ["Phone", contact.phone],
    ["Email", contact.email],
    ["Location", contact.location],
  ];
  for (const [label, value] of lines) if (filled(value)) blocks.push({ kind: "contact", label, value });
  for (const link of contact.links) {
    if (filled(link.url)) blocks.push({ kind: "contact", label: filled(link.label) ? link.label : null, value: link.url });
  }
  return blocks;
}

function titled(parts: (string | null)[]): string {
  return parts.filter(filled).join(` ${EM_DASH} `);
}

function section(title: string, body: Block[]): Block[] {
  return body.length === 0 ? [] : [{ kind: "heading", text: title.toUpperCase() }, ...body];
}

const bullets = (items: { text: string }[]): Block[] => items.map((item) => ({ kind: "bullet", text: item.text }));
const lines = (items: { text: string }[]): Block[] => items.map((item) => ({ kind: "line", text: item.text }));

export function layoutCv(cv: Cv): Block[] {
  const summary: Block[] = cv.summary !== null && filled(cv.summary.text) ? [{ kind: "line", text: cv.summary.text }] : [];

  const experience = cv.experience.flatMap((job): Block[] => {
    const left: TextSpan[] = [{ text: titled([job.title, job.company]), bold: true }];
    if (filled(job.location)) left.push({ text: `, ${job.location}` });
    return [{ kind: "entry", left, right: formatDateRange(job.dates) }, ...bullets(job.bullets)];
  });

  const projects = cv.projects.flatMap((project): Block[] => {
    const dates = project.dates === null ? null : formatDateRange(project.dates);
    return [
      { kind: "entry", left: [{ text: project.name, bold: true }], right: filled(project.url) ? project.url : null },
      ...(dates === null ? [] : [{ kind: "note", text: dates } as const]),
      ...bullets(project.bullets),
    ];
  });

  const education = cv.education.flatMap((school): Block[] => {
    const degree = [school.degree, school.field].filter(filled).join(", ");
    return [
      { kind: "entry", left: [{ text: titled([school.institution, degree]), bold: true }], right: formatDateRange(school.dates) },
      ...bullets(school.bullets),
    ];
  });

  const certifications = cv.certifications.map(
    (cert): Block => ({
      kind: "entry",
      left: [{ text: titled([cert.name, cert.issuer]) }],
      right: cert.date === null ? null : formatPartialDate(cert.date),
    }),
  );

  return [
    ...headerBlocks(cv.contact),
    ...section("Professional Summary", summary),
    ...section("Professional Experience", experience),
    ...section("Projects", projects),
    ...section("Education", education),
    ...section("Technical Skills", lines(cv.skills)),
    ...section("Certifications", certifications),
    ...cv.additionalSections.flatMap((extra) => section(extra.title, lines(extra.items))),
  ];
}
