import { useParams } from "react-router";
import { ErrorScreen, RunNotFoundScreen } from "@/features/run/screens";
import { RunScreen } from "@/features/run/RunScreen";
import { useRun } from "@/features/run/useRun";

export function RunRoute() {
  const { id = "" } = useParams();
  const { run, error, lostConnection, retry } = useRun(id);
  if (run) return <RunScreen run={run} lostConnection={lostConnection} />;
  if (error?.isNotFound) return <RunNotFoundScreen />;
  if (error?.isParseError) return <ErrorScreen message="We couldn't read the server's answer." />;
  if (error) return <ErrorScreen onRetry={retry} />;
  return (
    <section className="mx-auto w-full max-w-[560px] px-4 py-10 md:px-6">
      <p role="status" className="text-fg-2">Loading your Run…</p>
    </section>
  );
}
