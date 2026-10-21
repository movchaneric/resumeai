import type { ExtractedCv } from "@resume-ai/shared";

/**
 * NFKC, lowercase, every character that is not a letter, digit, combining mark or whitespace
 * becomes a space (letters and digits of any script are kept), whitespace collapsed.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Proves protected fields (company, title, institution, degree, field, certification name and the
 * year of every date) come from the CV text. Other text only counts as a soft mismatch.
 */
export function checkVerbatim(cv: ExtractedCv, sourceText: string): { issues: string[]; softMismatches: number } {
  const source = normalizeText(sourceText);
  const padded = ` ${source} `;
  const issues: string[] = [];
  let softMismatches = 0;

  const protectedField = (path: string, value: string | null) => {
    if (value === null) return;
    const needle = normalizeText(value);
    if (needle === "" || !padded.includes(` ${needle} `)) issues.push(`${path} "${value}" not found in the CV text`);
  };
  const year = (path: string, date: string | null) => {
    if (date === null) return;
    const y = date.slice(0, 4);
    if (!new RegExp(`(?<![\\p{N}])${y}(?![\\p{N}])`, "u").test(source)) {
      issues.push(`${path} year ${y} not found in the CV text`);
    }
  };
  const soft = (value: string) => {
    if (!source.includes(normalizeText(value))) softMismatches++;
  };
  const dates = (path: string, d: { start: string | null; end: string | null } | null) => {
    if (d === null) return;
    year(`${path}.dates.start`, d.start);
    year(`${path}.dates.end`, d.end);
  };

  cv.experience.forEach((e, i) => {
    protectedField(`experience[${i}].company`, e.company);
    protectedField(`experience[${i}].title`, e.title);
    dates(`experience[${i}]`, e.dates);
    e.bullets.forEach(soft);
  });
  cv.education.forEach((e, i) => {
    protectedField(`education[${i}].institution`, e.institution);
    protectedField(`education[${i}].degree`, e.degree);
    protectedField(`education[${i}].field`, e.field);
    dates(`education[${i}]`, e.dates);
    e.bullets.forEach(soft);
  });
  cv.projects.forEach((p, i) => {
    dates(`projects[${i}]`, p.dates);
    p.bullets.forEach(soft);
  });
  cv.certifications.forEach((c, i) => {
    protectedField(`certifications[${i}].name`, c.name);
    year(`certifications[${i}].date`, c.date);
  });
  if (cv.summary !== null) soft(cv.summary);
  cv.skills.forEach(soft);
  cv.additionalSections.forEach((s) => s.items.forEach(soft));

  return { issues, softMismatches };
}
