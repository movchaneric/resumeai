import { formatTenure, tenureOf } from "@resume-ai/shared";
import type { Cv, DateRange, Requirement, UserEvidence } from "@resume-ai/shared";

/** Prompt text for the CV: every Item on its own line, starting with `[<id>]`, so the model can cite IDs. */

function renderDates(dates: DateRange | null, today?: Date): string {
  if (dates === null) return "";
  const end = dates.current ? "present" : dates.end;
  if (dates.start === null && end === null) return "";
  const text = `${dates.start ?? "?"} – ${end ?? "?"}`;
  const tenure = today === undefined ? null : tenureOf(dates, today);
  return tenure === null ? text : `${text} (${formatTenure(tenure, today!)})`;
}

const joinParts = (parts: (string | null | undefined)[]) => parts.filter((p) => p && p.length > 0).join(", ");

const bulletLines = (bullets: { id: string; text: string }[]) => bullets.map((b) => `  [${b.id}] ${b.text}`);

const section = (heading: string, lines: string[]) => (lines.length === 0 ? null : [`## ${heading}`, ...lines].join("\n"));

/**
 * The CV as prompt text. With `today`, each dated Item also shows how long it lasted as of that day (a range when a
 * date is a bare year). Only the Coverage chain passes it: the tailor, claim check and condense prompts must not see
 * tenure, or the tailor might write it into the CV.
 */
export function renderCv(cv: Cv, today?: Date): string {
  const contact = [
    cv.contact.name,
    cv.contact.headline,
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
        `[${e.id}] ${joinParts([e.title, e.company, e.location, renderDates(e.dates, today)])}`,
        ...bulletLines(e.bullets),
      ]),
    ),
    section(
      "Education",
      cv.education.flatMap((e) => [
        `[${e.id}] ${joinParts([e.degree, e.field, e.institution, renderDates(e.dates, today)])}`,
        ...bulletLines(e.bullets),
      ]),
    ),
    section("Skills", cv.skills.map((s) => `[${s.id}] ${s.text}`)),
    section(
      "Projects",
      cv.projects.flatMap((p) => [
        `[${p.id}] ${joinParts([p.name, p.url, renderDates(p.dates, today)])}`,
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

/** One line per Requirement: `[req1] (skill, must-have) <text>`. The kind shows the model which rules apply (soft skills are binary). */
export function renderRequirements(requirements: Requirement[]): string {
  return requirements.map((r) => `[${r.id}] (${r.kind}, ${IMPORTANCE_LABEL[r.importance]}) ${r.text}`).join("\n");
}

/**
 * The user's Answers as a block of citable lines, `[ue1] <requirement text>: <answer>`, for the Requirements in the call.
 * Empty string when none apply. The IDs are the User Evidence IDs the model may cite like CV Item IDs.
 */
export function renderUserEvidence(userEvidence: UserEvidence[], requirements: Requirement[]): string {
  const textOf = new Map(requirements.map((r) => [r.id as string, r.text]));
  const lines = userEvidence.flatMap((u) => {
    const text = textOf.get(u.requirementId);
    return text === undefined ? [] : [`[${u.id}] ${text}: ${u.text}`];
  });
  return lines.length === 0 ? "" : `User answers (the candidate's own words, not in the CV):\n${lines.join("\n")}`;
}
