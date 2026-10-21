/**
 * Rebuilds visual reading order from positioned PDF text items. Pure: no PDF library involved.
 * Coordinates follow PDF space: the origin is the bottom-left, so y grows upward.
 * Out of scope: tables and three or more columns (those fall back to top-to-bottom lines).
 */

export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Items whose baselines differ by at most this fraction of the median item height share a line (absorbs baseline jitter). */
export const LINE_TOLERANCE_RATIO = 0.5;
/** A gap wider than this fraction of the median item height gets a single space between neighbours; narrower gaps get none. */
export const SPACE_GAP_RATIO = 0.15;
/** A gap wider than this multiple of the median item height is a column-like break, written as `WIDE_SEPARATOR`. */
export const WIDE_GAP_RATIO = 1.5;
export const WIDE_SEPARATOR = "  ";
/** The column gutter must be at least this fraction of the page width. */
export const MIN_GUTTER_WIDTH_RATIO = 0.02;
/** Fraction of lines allowed to cross the gutter (a full-width header, a stray wide line) before it stops being a gutter. */
export const MAX_GUTTER_CROSSING_RATIO = 0.1;
/** Each side of the gutter must span at least this fraction of the page width, so a column of right-aligned dates is not a column. */
export const MIN_COLUMN_WIDTH_RATIO = 0.2;
/** Each side of the gutter needs at least this many lines, so a short page of title/date pairs is not split. */
export const MIN_COLUMN_LINES = 4;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const right = (item: TextItem) => item.x + item.width;

/** Groups items into rows of similar baseline, top row first, each row sorted left to right. */
function groupLines(items: TextItem[], tolerance: number): TextItem[][] {
  const byTop = [...items].sort((a, b) => b.y - a.y);
  const rows: { y: number; items: TextItem[] }[] = [];
  for (const item of byTop) {
    const row = rows.find((r) => Math.abs(r.y - item.y) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x));
}

function lineText(line: TextItem[], unit: number): string {
  let out = "";
  line.forEach((item, i) => {
    if (i === 0) {
      out = item.str;
      return;
    }
    const gap = item.x - right(line[i - 1]!);
    if (gap > WIDE_GAP_RATIO * unit) out = out.trimEnd() + WIDE_SEPARATOR + item.str.trimStart();
    else if (gap > SPACE_GAP_RATIO * unit && !/\s$/.test(out) && !/^\s/.test(item.str)) out += " " + item.str;
    else out += item.str;
  });
  return out.trimEnd();
}

function renderLines(lines: TextItem[][], unit: number): string {
  return lines
    .map((l) => lineText(l, unit))
    .filter((t) => t.trim() !== "")
    .join("\n");
}

/** Finds the x position that splits the page into a left and a right column, or null for a single-column page. */
function findGutter(lines: TextItem[][], pageWidth: number): number | null {
  const allowedCrossings = Math.floor(lines.length * MAX_GUTTER_CROSSING_RATIO);
  const edges = [...new Set(lines.flat().flatMap((i) => [i.x, right(i)]))].sort((a, b) => a - b);

  // Free bands: consecutive edge intervals that at most `allowedCrossings` lines cross, merged into maximal runs.
  const bands: { from: number; to: number }[] = [];
  for (let e = 0; e + 1 < edges.length; e++) {
    const from = edges[e]!;
    const to = edges[e + 1]!;
    const mid = (from + to) / 2;
    const crossings = lines.filter((l) => l.some((i) => i.x < mid && mid < right(i))).length;
    if (crossings > allowedCrossings) continue;
    const last = bands[bands.length - 1];
    if (last && last.to === from) last.to = to;
    else bands.push({ from, to });
  }

  const candidates = bands.filter((b) => b.to - b.from >= MIN_GUTTER_WIDTH_RATIO * pageWidth).sort((a, b) => b.to - b.from - (a.to - a.from));
  for (const band of candidates) {
    const mid = (band.from + band.to) / 2;
    const leftLines = lines.map((l) => l.filter((i) => i.x + i.width / 2 < mid)).filter((l) => l.length);
    const rightLines = lines.map((l) => l.filter((i) => i.x + i.width / 2 >= mid)).filter((l) => l.length);
    const span = (ls: TextItem[][]) => {
      const flat = ls.flat();
      return Math.max(...flat.map(right)) - Math.min(...flat.map((i) => i.x));
    };
    if (leftLines.length < MIN_COLUMN_LINES || rightLines.length < MIN_COLUMN_LINES) continue;
    if (span(leftLines) < MIN_COLUMN_WIDTH_RATIO * pageWidth || span(rightLines) < MIN_COLUMN_WIDTH_RATIO * pageWidth) continue;
    return mid;
  }
  return null;
}

/** Turns one page's positioned text items into text in reading order: left column then right, or top to bottom. */
export function layoutPage(items: TextItem[], pageWidth: number): string {
  const present = items.filter((i) => i.str.trim() !== "");
  if (!present.length) return "";

  const unit = median(present.map((i) => i.height).filter((h) => h > 0)) || 10;
  const tolerance = LINE_TOLERANCE_RATIO * unit;
  const lines = groupLines(present, tolerance);

  const gutter = findGutter(lines, pageWidth);
  if (gutter === null) return renderLines(lines, unit);

  const leftItems = present.filter((i) => i.x + i.width / 2 < gutter);
  const rightItems = present.filter((i) => i.x + i.width / 2 >= gutter);
  return [renderLines(groupLines(leftItems, tolerance), unit), renderLines(groupLines(rightItems, tolerance), unit)].join("\n");
}
