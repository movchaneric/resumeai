import type { DateRange } from "./common.js";

/**
 * How long a dated Item lasted, in whole months, as a range. A bare-year date is uncertain by up to 11 months:
 * a bare-year start is earliest January and latest December, a bare-year end the reverse. A month date is exact, and a
 * current range ends at `today`. `minMonths === maxMonths` when nothing is uncertain.
 */
export type Tenure = { minMonths: number; maxMonths: number };

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Months since year 0 of the first and last month a partial date can mean. */
function span(date: string): { first: number; last: number } {
  const [year, month] = date.split("-");
  const base = Number(year) * 12;
  return month === undefined ? { first: base, last: base + 11 } : { first: base + Number(month) - 1, last: base + Number(month) - 1 };
}

const monthOfToday = (today: Date) => today.getUTCFullYear() * 12 + today.getUTCMonth();

/** Tenure of a range as of `today` (injected so callers and tests pin it). Null when the start, or a non-current end, is unknown. */
export function tenureOf(dates: DateRange | null, today: Date): Tenure | null {
  if (dates === null || dates.start === null) return null;
  if (!dates.current && dates.end === null) return null;
  const start = span(dates.start);
  const end = dates.current ? { first: monthOfToday(today), last: monthOfToday(today) } : span(dates.end!);
  return { minMonths: Math.max(0, end.first - start.last), maxMonths: Math.max(0, end.last - start.first) };
}

const years = (months: number) => {
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y === 0 ? `${m}m` : m === 0 ? `${y}y` : `${y}y${m}m`;
};

/** `1y11m to 2y10m as of Nov 2026`, or `2y8m as of Nov 2026` when exact. */
export function formatTenure(tenure: Tenure, today: Date): string {
  const asOf = `as of ${MONTH_NAMES[today.getUTCMonth()]} ${today.getUTCFullYear()}`;
  const value = tenure.minMonths === tenure.maxMonths ? years(tenure.minMonths) : `${years(tenure.minMonths)} to ${years(tenure.maxMonths)}`;
  return `${value} ${asOf}`;
}

/**
 * The duration a Requirement text asks for, in months: "2+ years", "3 years", "5 yrs". Narrow on purpose: a range
 * ("3-5 years"), months, or no number gives null and is left to the model.
 */
export function durationMonthsOf(text: string): number | null {
  if (/\d\s*[-–]\s*\d+\s*\+?\s*(years?|yrs?)\b/i.test(text)) return null;
  const match = /(\d+)\s*\+?\s*(?:years?|yrs?)\b/i.exec(text);
  return match ? Number(match[1]) * 12 : null;
}
