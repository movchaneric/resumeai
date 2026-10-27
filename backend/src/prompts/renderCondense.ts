import type { Requirement } from "@resume-ai/shared";
import { renderRequirements } from "@/prompts/renderCv.js";

/** An Item the condense prompts show: its ID and its text in the draft CV. */
export type CondenseItem = { id: string; text: string };

const line = (item: CondenseItem) => `[${item.id}] ${item.text}`;
const lines = (count: number) => `${count} ${count === 1 ? "line" : "lines"}`;

/**
 * The reword step's user message: how far over one page the CV is, and the Items it may shorten, longest first
 * (shortening the longest saves the most). Pure.
 */
export function renderRewordInput({ items, overByLines }: { items: CondenseItem[]; overByLines: number }): string {
  const longestFirst = [...items].sort((a, b) => b.text.length - a.text.length);
  return [
    `The CV is over one page by about ${lines(overByLines)}.`,
    `Items you may shorten, longest first:\n${longestFirst.map(line).join("\n")}`,
  ].join("\n\n");
}

/** The drop step's user message: the lines over, the Requirements, and only the bullets that may be dropped. Pure. */
export function renderDropInput({ bullets, requirements, overByLines }: { bullets: CondenseItem[]; requirements: Requirement[]; overByLines: number }): string {
  return [
    `The CV is over one page by about ${lines(overByLines)}.`,
    `Requirements of the job:\n${renderRequirements(requirements)}`,
    `Bullets you may drop:\n${bullets.map(line).join("\n")}`,
  ].join("\n\n");
}
