import type { ReactNode } from "react";
import { Link } from "react-router";
import type { RunView } from "@resume-ai/shared";

type Of<S extends RunView["status"]> = Extract<RunView, { status: S }>;

/** One screen: a title, a lead, and the single `role="status"` region that announces a sentence. */
export function Screen({ title, lead, status, children }: { title: string; lead?: string; status: string; children?: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-10 md:px-6">
      <h1 className="text-[28px] leading-tight">{title}</h1>
      {lead && <p className="text-[17px] text-fg-2">{lead}</p>}
      <p role="status" className="min-h-6 text-sm font-semibold text-fg-2">
        {status}
      </p>
      {children}
    </section>
  );
}

/** Placeholder until the Review screen (slice 7c): the score and the number of Changes. */
export function ReviewPlaceholder({ run, notice }: { run: Of<"awaiting_review">; notice: string }) {
  const n = run.changes.length;
  return (
    <Screen title="Review your Changes" lead="The Review screen is coming soon." status={notice || `Ready for your Review: ${n} ${n === 1 ? "Change" : "Changes"}.`}>
      <dl className="grid grid-cols-2 gap-3 rounded-hero bg-surface p-5 ring-1 ring-line">
        <div>
          <dt className="text-sm font-semibold text-fg-3">Match Score</dt>
          <dd className="text-2xl font-bold tabular-nums">
            {Math.round(run.score.before)} → {Math.round(run.score.after)}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-semibold text-fg-3">Changes</dt>
          <dd className="text-2xl font-bold tabular-nums">{n}</dd>
        </div>
      </dl>
    </Screen>
  );
}

export function StartNewRun() {
  return (
    <Link to="/" className="self-start font-semibold text-accent underline">
      Start a new Run
    </Link>
  );
}

/** The Run does not exist, or it expired (404). */
export function RunNotFoundScreen() {
  return (
    <Screen title="This Run doesn't exist or has expired" status="Run not found.">
      <p className="text-[15px] text-fg-2">A Run is deleted after 7 days, or sooner if you delete it.</p>
      <StartNewRun />
    </Screen>
  );
}

/** A response the client could not read, or a failed load. */
export function ErrorScreen({ onRetry, message = "Something went wrong while loading this page." }: { onRetry?: () => void; message?: string }) {
  return (
    <Screen title="Something went wrong" status={message}>
      <div className="flex flex-wrap items-center gap-4">
        {onRetry && (
          <button type="button" onClick={onRetry} className="font-semibold text-accent underline">
            Try again
          </button>
        )}
        <StartNewRun />
      </div>
    </Screen>
  );
}
