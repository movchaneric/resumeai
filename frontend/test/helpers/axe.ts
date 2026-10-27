import { expect } from "vitest";
import { configureAxe } from "vitest-axe";

const run = configureAxe({ rules: { "color-contrast": { enabled: false } } }); // jsdom has no layout; contrast is measured in MASTER.md.

/** Runs axe on a rendered container and fails on serious or critical violations. */
export async function expectNoSeriousViolations(container: Element): Promise<void> {
  const { violations } = await run(container);
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const lines = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.html).join("\n  ")}`);
  expect(lines, `axe found serious or critical violations:\n${lines.join("\n")}`).toEqual([]);
}
