import { z } from "zod";
import type { Coverage, Cv, Requirement } from "@resume-ai/shared";

const PartialDate = z.string().nullable();

/** Hand-written answer key: protected facts only. Bullet text and the summary are never compared. */
export const ExpectedSchema = z.object({
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      start: PartialDate,
      end: PartialDate,
      current: z.boolean(),
      bullets: z.number().int().nonnegative(),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string(),
      degree: z.string().nullable(),
      start: PartialDate,
      end: PartialDate,
    }),
  ),
  certifications: z.array(z.string()),
});
export type Expected = z.infer<typeof ExpectedSchema>;

const norm = (value: string | null): string | null => (value === null ? null : value.trim());
const show = (value: string | number | boolean | null | undefined): string => (value === null || value === undefined ? "null" : String(value));

/** Compares entries in order, with exact string equality after trimming. Returns one line per mismatch; empty means all match. */
export function compareToExpected(cv: Cv, expected: Expected): string[] {
  const out: string[] = [];
  const field = (path: string, want: string | number | boolean | null, got: string | number | boolean | null) => {
    const w = typeof want === "string" ? want.trim() : want;
    const g = typeof got === "string" ? got.trim() : got;
    if (w !== g) out.push(`${path}: expected ${show(w)}, got ${show(g)}`);
  };
  const list = <A, B>(name: string, want: A[], got: B[], compare: (path: string, w: A, g: B) => void, label: (w: A) => string, glabel: (g: B) => string) => {
    want.forEach((w, i) => {
      const g = got[i];
      if (g === undefined) out.push(`${name}[${i}]: missing, expected ${label(w)}`);
      else compare(`${name}[${i}]`, w, g);
    });
    got.slice(want.length).forEach((g, j) => out.push(`${name}[${want.length + j}]: extra, got ${glabel(g)}`));
  };

  list(
    "experience",
    expected.experience,
    cv.experience,
    (p, w, g) => {
      field(`${p}.company`, w.company, g.company);
      field(`${p}.title`, w.title, g.title);
      field(`${p}.start`, norm(w.start), norm(g.dates.start));
      field(`${p}.end`, norm(w.end), norm(g.dates.end));
      field(`${p}.current`, w.current, g.dates.current);
      field(`${p}.bullets`, w.bullets, g.bullets.length);
    },
    (w) => `${w.title} at ${w.company}`,
    (g) => `${g.title} at ${g.company}`,
  );
  list(
    "education",
    expected.education,
    cv.education,
    (p, w, g) => {
      field(`${p}.institution`, w.institution, g.institution);
      field(`${p}.degree`, norm(w.degree), norm(g.degree));
      field(`${p}.start`, norm(w.start), norm(g.dates.start));
      field(`${p}.end`, norm(w.end), norm(g.dates.end));
    },
    (w) => w.institution,
    (g) => g.institution,
  );
  list(
    "certifications",
    expected.certifications,
    cv.certifications,
    (p, w, g) => field(p, w, g.name),
    (w) => w,
    (g) => g.name,
  );
  return out;
}

/** Hand-written verdict key for one job description. Matched to Requirements by text, never by id. */
export const CoverageKeySchema = z.array(
  z.object({ requirement: z.string(), verdict: z.enum(["met", "partially_met", "unmet"]) }),
);
export type CoverageKey = z.infer<typeof CoverageKeySchema>;

const normText = (value: string): string => value.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Compares Coverage with the verdict key. A key entry matches a Requirement when one normalized text contains the other;
 * the first Requirement in Job Profile order wins. Returns one warning line per mismatch or unmatched entry.
 */
export function compareCoverageToKey(requirements: Requirement[], coverage: Coverage[], key: CoverageKey): string[] {
  const verdictById = new Map(coverage.map((c) => [c.requirementId as string, c.verdict]));
  const out: string[] = [];
  for (const entry of key) {
    const wanted = normText(entry.requirement);
    const requirement = requirements.find((r) => {
      const text = normText(r.text);
      return text.includes(wanted) || wanted.includes(text);
    });
    if (!requirement) {
      out.push(`"${entry.requirement}": no Requirement matches this key entry`);
      continue;
    }
    const got = verdictById.get(requirement.id) ?? "missing";
    if (got !== entry.verdict) out.push(`"${entry.requirement}": expected ${entry.verdict}, got ${got} (${requirement.id})`);
  }
  return out;
}
