import type { RunView } from "@resume-ai/shared";
import {
  DoneScreen,
  ExtractingScreen,
  FailedScreen,
  InterruptedScreen,
  ParsingScreen,
  QuestionsScreen,
  ReviewPlaceholder,
  TailoringScreen,
} from "@/features/run/screens";

/** One screen per status, so a refresh or a shared link lands on the right step. */
export function RunScreen({ run, lostConnection }: { run: RunView; lostConnection: boolean }) {
  const notice = lostConnection ? "Lost connection. Retrying…" : "";
  switch (run.status) {
    case "parsing":
      return <ParsingScreen run={run} notice={notice} />;
    case "extracting":
      return <ExtractingScreen run={run} notice={notice} />;
    case "awaiting_answers":
      return <QuestionsScreen run={run} notice={notice} />;
    case "tailoring":
      return <TailoringScreen run={run} notice={notice} />;
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
