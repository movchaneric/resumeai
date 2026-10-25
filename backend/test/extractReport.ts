// Pure printing and argument helpers for the dev script (test/extract.ts), kept apart so tests can import them
// without running the script.
import { randomUUID } from "node:crypto";
import type { Change, Coverage, ExitReason, Requirement, RunId } from "@resume-ai/shared";
import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import type { RoundSummary } from "@/graph/runGraph.js";
import { LangGraphRunner } from "@/graph/runner.js";
import type { LlmClient } from "@/llm/llmClient.js";
import type { RunSnapshot } from "@/services/runs.js";
import { withSessionSpan } from "@/utils/spans.js";

export type DevArgs =
  | { ok: true; cvArg: string; jdArg: string; check: boolean; tailor: boolean; coverage: boolean }
  | { ok: false };

/** `--tailor` implies `--coverage`. Exactly two paths are needed. */
export function parseDevArgs(args: string[]): DevArgs {
  const tailor = args.includes("--tailor");
  const check = args.includes("--check");
  const coverage = tailor || args.includes("--coverage");
  const paths = args.filter((a) => a !== "--tailor" && a !== "--check" && a !== "--coverage");
  const [cvArg, jdArg, ...rest] = paths;
  if (!cvArg || !jdArg || rest.length > 0) return { ok: false };
  return { ok: true, cvArg, jdArg, check, tailor, coverage };
}

const list = (ids: string[]) => (ids.length > 0 ? ids.join(", ") : "none");

/** One block per Requirement: importance and kind, then the verdict with its evidence and reason. */
export function formatCoverage(requirements: Requirement[], coverage: Coverage[]): string[] {
  return requirements.flatMap((requirement) => {
    const c = coverage.find((x) => x.requirementId === requirement.id);
    return [
      `${requirement.id} [${requirement.importance}] [${requirement.kind}] ${requirement.text}`,
      `  verdict: ${c?.verdict ?? "missing"}  evidence: ${list(c?.evidenceIds ?? [])}`,
      `  reason: ${c?.reason ?? ""}`,
    ];
  });
}

function changeHead(change: Change): string {
  if (change.op === "replace") return `${change.id} replace ${change.targetItemId}`;
  if (change.op === "add") return `${change.id} add under ${change.parentId}`;
  return `${change.id} reorder ${change.parentId}`;
}

function changeBody(change: Change): string[] {
  const body =
    change.op === "replace"
      ? `  "${change.before}" -> "${change.after}"`
      : change.op === "add"
        ? `  (new) -> "${change.after}"`
        : `  order: ${list(change.orderedItemIds)}`;
  return [body, `  evidence: ${list(change.evidenceIds)}  requirements: ${list(change.requirementIds)}`];
}

export function formatChange(change: Change): string[] {
  return [changeHead(change), ...changeBody(change)];
}

/** A round: its Changes (rejected ones marked with stage and reason), then whether it was kept and the scores. */
export function formatRound(round: RoundSummary): string[] {
  const rejected = new Map(round.rejections.map((r) => [r.change.id, r]));
  const lines = [`----- ROUND ${round.round} -----`, `proposed: ${round.proposed.length}, valid: ${round.valid.length}, rejected: ${round.rejections.length}`];
  if (round.failed) lines.push("round failed (the exit router ends the Run)");
  for (const change of round.proposed) {
    const r = rejected.get(change.id);
    lines.push(r ? `${changeHead(change)}  REJECTED (${r.stage}): ${r.reason}` : changeHead(change), ...changeBody(change));
  }
  lines.push(`round kept: ${round.kept ? "yes" : "no"}  round score: ${round.roundScore ?? "none"}  kept score: ${round.keptScore}`);
  return lines;
}

export function formatOutcome(s: { exitReason: ExitReason | null; rounds: number; scoreBefore: number | null; scoreAfter: number | null }): string[] {
  const rounded = (n: number | null) => (n === null ? "none" : String(Math.round(n)));
  return [
    "----- OUTCOME -----",
    `exit reason: ${s.exitReason ?? "none"} (${s.rounds} rounds)`,
    `score: ${rounded(s.scoreBefore)} -> ${rounded(s.scoreAfter)} (unrounded ${s.scoreBefore} -> ${s.scoreAfter})`,
  ];
}

/** Runs the whole Run graph in memory: no database, no status writes. `llm` does extraction, `judgeLlm` the rest. */
export async function runTailorInMemory(input: {
  llm: LlmClient;
  judgeLlm: LlmClient;
  cvText: string;
  jobDescriptionText: string;
  onRound?: (summary: RoundSummary) => void;
}): Promise<RunSnapshot> {
  const runner = new LangGraphRunner(
    { llm: input.llm, judgeLlm: input.judgeLlm, checkpointer: createMemoryCheckpointer(), onRound: input.onRound },
    { setStatus: async () => {} },
  );
  return runner.start({ runId: randomUUID() as RunId, cvText: input.cvText, jobDescriptionText: input.jobDescriptionText });
}

/** One `pipeline` root span for the whole script run, so Phoenix groups its chains as one trace. */
export function runInPipelineSpan<T>(fn: () => Promise<T>): Promise<T> {
  return withSessionSpan("pipeline", randomUUID(), fn);
}
