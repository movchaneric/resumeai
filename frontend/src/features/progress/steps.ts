import type { RunView, StepState } from "@resume-ai/shared";

type Step = RunView["steps"][number];

export type RowKey = "read" | "coverage" | "questions" | "tailor" | "fit" | "review";

/** The step list in user language: which step keys make each row. `export` is not shown. */
const ROWS: { key: RowKey; label: string; stepKeys: Step["key"][] }[] = [
  { key: "read", label: "Read your CV and the job", stepKeys: ["parse", "extract"] },
  { key: "coverage", label: "Checked the Requirements", stepKeys: ["coverage"] },
  { key: "questions", label: "Your answers", stepKeys: ["questions"] },
  { key: "tailor", label: "Tailoring", stepKeys: ["tailor"] },
  { key: "fit", label: "Fit it on one page", stepKeys: ["fit"] },
  { key: "review", label: "Your Review", stepKeys: ["review"] },
];

export interface StepRow {
  key: RowKey;
  label: string;
  state: StepState;
}

/** One row per group that has at least one step in the view. A group is failed if any step failed, running if any runs, done when all are. */
export function stepRows(steps: Step[]): StepRow[] {
  const rows: StepRow[] = [];
  for (const row of ROWS) {
    const own = steps.filter((s) => row.stepKeys.includes(s.key));
    if (own.length === 0) continue;
    const state: StepState = own.some((s) => s.state === "failed")
      ? "failed"
      : own.some((s) => s.state === "running")
        ? "running"
        : own.every((s) => s.state === "done")
          ? "done"
          : "pending";
    rows.push({ key: row.key, label: row.label, state });
  }
  return rows;
}

export const EXPLANATION: Partial<Record<RowKey, string>> = {
  tailor: "Rewording bullets toward the Requirements, checking each against its Evidence.",
  fit: "Rewording shorter, then removing the least relevant bullets. You'll decide on each.",
};
