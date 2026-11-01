import type { RunStatus } from "@resume-ai/shared";

export type RunStage = "answering" | "in_progress" | "in_review" | "done" | "failed";

export const STAGE_LABEL: Record<RunStage, string> = {
  answering: "Needs answers",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  failed: "Failed",
};

/** Every Run status maps to one stage. A `Record` over `RunStatus` fails typecheck when a status is added without a stage. */
export const STAGE_OF: Record<RunStatus, RunStage> = {
  parsing: "in_progress",
  extracting: "in_progress",
  tailoring: "in_progress",
  awaiting_answers: "answering",
  awaiting_review: "in_review",
  completed: "done",
  failed: "failed",
  // The server restarted mid-Run: it will not continue, so to the owner it is a Run that did not finish.
  interrupted: "failed",
};
