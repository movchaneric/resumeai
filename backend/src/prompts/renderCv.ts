import type { Cv, DateRange, Requirement } from "@resume-ai/shared";

/** Prompt text for the CV: every Item on its own line, starting with `[<id>]`, so the model can cite IDs. */

function renderDates(dates: DateRange | null): string {
  if (dates === null) return "";
  const end = dates.current ? "present" : dates.end;
  if (dates.start === null && end === null) return "";
  return `${dates.start ?? "?"} – ${end ?? "?"}`;
}

const joinParts = (parts: (string | null | undefined)[]) => parts.filter((p) => p && p.length > 0).join(", ");

const bulletLines = (bullets: { id: string; text: string }[]) => bullets.map((b) => `  [${b.id}] ${b.text}`);

const section = (heading: string, lines: string[]) => (lines.length === 0 ? null : [`## ${heading}`, ...lines].join("\n"));

export function renderCv(cv: Cv): string {
  const contact = [
    cv.contact.name,
    cv.contact.email,
    cv.contact.phone,
    cv.contact.location,
    ...cv.contact.links.map((l) => (l.label ? `${l.label}: ${l.url}` : l.url)),
  ];

  const sections = [
    section("Contact", [`[${cv.contact.id}] ${joinParts(contact)}`]),
    section("Summary", cv.summary ? [`[${cv.summary.id}] ${cv.summary.text}`] : []),
    section(
      "Experience",
      cv.experience.flatMap((e) => [
        `[${e.id}] ${joinParts([e.title, e.company, e.location, renderDates(e.dates)])}`,
        ...bulletLines(e.bullets),
      ]),
    ),
    section(
      "Education",
      cv.education.flatMap((e) => [
        `[${e.id}] ${joinParts([e.degree, e.field, e.institution, renderDates(e.dates)])}`,
        ...bulletLines(e.bullets),
      ]),
    ),
    section("Skills", cv.skills.map((s) => `[${s.id}] ${s.text}`)),
    section(
      "Projects",
      cv.projects.flatMap((p) => [
        `[${p.id}] ${joinParts([p.name, p.url, renderDates(p.dates)])}`,
        ...bulletLines(p.bullets),
      ]),
    ),
    section(
      "Certifications",
      cv.certifications.map((c) => `[${c.id}] ${joinParts([c.name, c.issuer, c.date])}`),
    ),
    ...cv.additionalSections.map((s) => section(s.title, s.items.map((i) => `[${i.id}] ${i.text}`))),
  ];

  return sections.filter((s): s is string => s !== null).join("\n\n");
}

const IMPORTANCE_LABEL = { must_have: "must-have", nice_to_have: "nice-to-have" } as const;

/** One line per Requirement: `[req1] (must-have) <text>`. */
export function renderRequirements(requirements: Requirement[]): string {
  return requirements.map((r) => `[${r.id}] (${IMPORTANCE_LABEL[r.importance]}) ${r.text}`).join("\n");
}
