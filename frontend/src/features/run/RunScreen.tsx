import type { RunView } from "@resume-ai/shared";
import { DoneScreen } from "@/features/done/DoneScreen";
import { QuestionsScreen } from "@/features/questions/QuestionsScreen";
import {
  ReviewPlaceholder,
} from "@/features/run/screens";
import { FailedScreen, InterruptedScreen, ProgressScreen } from "@/features/progress/ProgressScreen";

/** One screen per status, so a refresh or a shared link lands on the right step. */
export function RunScreen({ run, lostConnection }: { run: RunView; lostConnection: boolean }) {
  const notice = lostConnection ? "Lost connection. Retrying…" : "";
  switch (run.status) {
    case "parsing":
    case "extracting":
    case "tailoring":
      return <ProgressScreen run={run} notice={notice} />;
    case "awaiting_answers":
      return <QuestionsScreen run={run} notice={notice} />;
    case "awaiting_review":
      return <ReviewPlaceholder run={run} notice={notice} />;
    case "completed":
      return <DoneScreen run={run} notice={notice} />;
    case "failed":
      return <FailedScreen run={run} />;
    case "interrupted":
      return <InterruptedScreen />;
  }
}
