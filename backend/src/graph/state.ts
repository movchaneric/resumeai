import { Annotation } from "@langchain/langgraph";
import type { Change, Coverage, Cv, ExitReason, JobProfile } from "@resume-ai/shared";

/** A channel that keeps the last value written. `default` is what a node sees before anything wrote to it. */
const last = <T>(initial: T) => Annotation<T>({ reducer: (_current, update) => update, default: () => initial });

/**
 * The graph state is the only store for Run data (ADR 0003). Later tickets add the tailoring fields
 * (rejections, the pending round) beside these; nothing here has to change shape for them.
 */
export const RunState = Annotation.Root({
  /** Inputs, passed by the service when the graph starts. */
  runId: last(""),
  cvText: last(""),
  jobDescriptionText: last(""),
  /** Extraction. */
  jobProfile: last<JobProfile | null>(null),
  cv: last<Cv | null>(null),
  /** Coverage from the first call, never changed afterwards, and the verdicts of the last kept round. */
  coverageBefore: last<Coverage[] | null>(null),
  coverage: last<Coverage[] | null>(null),
  /** The current set of validated Changes (empty until tailoring exists). */
  changes: last<Change[]>([]),
  /** Unrounded Match Scores: before tailoring, and after the last kept round. */
  scoreBefore: last<number | null>(null),
  scoreAfter: last<number | null>(null),
  /** Tailoring rounds started. */
  rounds: last(0),
  exitReason: last<ExitReason | null>(null),
});

export type RunStateValues = typeof RunState.State;
