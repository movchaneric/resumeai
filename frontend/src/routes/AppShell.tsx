import { Link, Outlet, useMatch } from "react-router";
import { RunActions } from "@/features/run/RunActions";
import { useCachedRun } from "@/features/run/useRun";

function jobLine(job: { title: string | null; company: string | null } | null | undefined): string | null {
  const parts = [job?.title, job?.company].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The header on every page, and the page below it. */
export function AppShell() {
  const runId = useMatch("/runs/:id")?.params.id;
  const job = jobLine(useCachedRun(runId)?.job);
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 md:px-6">
          <Link to="/" className="flex shrink-0 items-center gap-2 font-bold tracking-tight">
            <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-sm bg-fg text-sm text-surface">
              R
            </span>
            Resume AI
          </Link>
          {job && <span className="hidden min-w-0 truncate text-sm text-fg-2 sm:block">{job}</span>}
          <div className="ml-auto flex items-center gap-2">
            {runId && <RunActions runId={runId} />}
            <Link to="/sign-in" className="shrink-0 whitespace-nowrap rounded-sm px-2 py-2 text-sm font-semibold text-accent hover:bg-accent-soft">
              Sign in
            </Link>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
