import type { RunSnapshot } from "@/services/runs.js";

/** The part of a LangGraph state snapshot the position needs: the nodes due to run and the tasks with their interrupts. */
export type GraphStateShape = {
  next: readonly string[];
  tasks: readonly { name: string; interrupts: readonly unknown[] }[];
};

/**
 * Where the graph is, in one place: `answers` or `review` while a node waits inside its `interrupt()`, `ended` when
 * nothing is left to run, and `null` while a node is due to run. A node paused in `interrupt()` stays in `next`, and
 * its task carries the interrupt; an empty `next` means the graph ran to the end. Nothing else may read `next`.
 */
export function positionOf(state: GraphStateShape): RunSnapshot["position"] {
  if (state.next.length === 0) return "ended";
  const waiting = (node: string) => state.tasks.some((task) => task.name === node && task.interrupts.length > 0);
  if (waiting("collect_answers")) return "answers";
  if (waiting("review")) return "review";
  return null;
}
