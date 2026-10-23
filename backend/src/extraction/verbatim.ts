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

const MONTH_NAMES: Record<string, string> = {
  "01": "jan(?:uary)?",
  "02": "feb(?:ruary)?",
  "03": "mar(?:ch)?",
  "04": "apr(?:il)?",
  "05": "may",
  "06": "june?",
  "07": "july?",
  "08": "aug(?:ust)?",
  "09": "sept?(?:ember)?",
  "10": "oct(?:ober)?",
  "11": "nov(?:ember)?",
  "12": "dec(?:ember)?",
};

const APOSTROPHE = "['\u2018\u2019]";
const ANY_MONTH_NAME = Object.values(MONTH_NAMES).join("|");

/**
 * True when the raw source shows this month next to this year: a name (before or after the year, joined by
 * space, comma, / . or -), a number with / - . , or a two-digit year form (`03/21`, `Mar '21`, `Mar-21`).
 */
function monthProven(raw: string, year: string, month: string): boolean {
  const n = String(Number(month));
  const num = `0?${n}`;
  const name = MONTH_NAMES[month]!;
  const yy = year.slice(2);
  const notNum = (re: string) => `(?<![\\p{N}])(?:${re})(?![\\p{N}])`;
  const sep = "\\s*[/.-]\\s*";
  const forms = [
    `(?<![\\p{L}])${name}\\.?\\s*[,/.-]?\\s*${year}`,
    `${year}\\s*[,/.-]?\\s*${name}(?![\\p{L}])`,
    `${num}${sep}${year}`,
    `${year}${sep}${num}`,
    `${num}\\s*/\\s*${yy}`,
    `(?<![\\p{L}])${name}\\.?\\s*${APOSTROPHE}\\s*${yy}`,
    `(?<![\\p{L}])${name}\\.?\\s*-\\s*${yy}`,
  ];
  return new RegExp(notNum(forms.join("|")), "u").test(raw);
}

/** True when the raw source writes this year in two digits as part of a date: `03/21`, `'21`, `Mar '21`, `Mar-21`. */
function shortYearProven(raw: string, year: string): boolean {
  const yy = year.slice(2);
  const forms = [
    `(?<![\\p{N}])(?:0?[1-9]|1[0-2])\\s*/\\s*${yy}`,
    `${APOSTROPHE}\\s*${yy}`,
    `(?<![\\p{L}])(?:${ANY_MONTH_NAME})\\.?\\s*-\\s*${yy}`,
  ];
  return new RegExp(`(?:${forms.join("|")})(?![\\p{N}])`, "u").test(raw);
}

/**
 * Proves protected fields (company, title, institution, degree, field, certification name and the
 * year of every date, and the month of YYYY-MM dates) come from the CV text. Other text only counts as a soft mismatch.
 */
export function checkVerbatim(cv: ExtractedCv, sourceText: string): { issues: string[]; softMismatches: number } {
  const source = normalizeText(sourceText);
  const raw = sourceText.normalize("NFKC").toLowerCase();
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
    const fourDigits = new RegExp(`(?<![\\p{N}])${y}(?![\\p{N}])`, "u").test(source);
    if (!fourDigits && !shortYearProven(raw, y)) {
      issues.push(`${path} year ${y} not found in the CV text`);
      return;
    }
    const m = /^\d{4}-(\d{2})$/.exec(date)?.[1];
    if (m !== undefined && MONTH_NAMES[m] !== undefined && !monthProven(raw, y, m)) {
      issues.push(`${path} month ${m} of ${y} not found in the CV text; if the CV gives only the year, write the year alone`);
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
