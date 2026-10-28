import type { ReactNode } from "react";
import { Link } from "react-router";
import type { RunView } from "@resume-ai/shared";
import { downloadUrl } from "@/api";
import { Chip } from "@/ui/Chip";

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

const LEAD_WHILE_WORKING = "You can leave this page. Your Run keeps going, and the link to this page brings you back to it.";

export function ParsingScreen({ notice }: { run: Of<"parsing">; notice: string }) {
  return <Screen title="Reading your CV…" lead={LEAD_WHILE_WORKING} status={notice || "Reading your CV."} />;
}

export function ExtractingScreen({ notice }: { run: Of<"extracting">; notice: string }) {
  return <Screen title="Tailoring your CV" lead={LEAD_WHILE_WORKING} status={notice || "Reading the Job Description."} />;
}

export function TailoringScreen({ run, notice }: { run: Of<"tailoring">; notice: string }) {
  const { before, after } = run.score;
  const delta = after === null ? null : Math.round(after - before);
  const round = `Round ${Math.min(run.iterations.used + 1, run.iterations.max)} of ${run.iterations.max}`;
  return (
    <Screen title="Tailoring your CV" lead={LEAD_WHILE_WORKING} status={notice || `Tailoring, ${round.toLowerCase()}.`}>
      <div className="flex flex-wrap items-center gap-3 rounded-hero bg-surface p-5 ring-1 ring-line">
        <span className="text-sm font-semibold text-fg-3">Match Score</span>
        <span className="text-2xl font-bold tabular-nums">{Math.round(before)}</span>
        <span aria-hidden="true">→</span>
        <span className="text-2xl font-bold tabular-nums">{after === null ? "—" : Math.round(after)}</span>
        {delta !== null && delta > 0 && <Chip variant="delta">+{delta}</Chip>}
        <span className="ml-auto text-sm text-fg-3">{round}</span>
      </div>
    </Screen>
  );
}

export function QuestionsScreen({ run, notice }: { run: Of<"awaiting_answers">; notice: string }) {
  const n = run.questions.length;
  return <Screen title="A few questions" lead="Questions screen coming soon." status={notice || `${n} ${n === 1 ? "Question" : "Questions"} to answer.`} />;
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

export function DoneScreen({ run, notice }: { run: Of<"completed">; notice: string }) {
  return (
    <Screen title="Your Tailored CV is ready" status={notice || "Your Tailored CV is ready to download."}>
      <div className="flex flex-wrap gap-3">
        <a href={downloadUrl(run.id, "pdf")} className="font-semibold text-accent underline">
          Download PDF
        </a>
        <a href={downloadUrl(run.id, "docx")} className="font-semibold text-accent underline">
          Download DOCX
        </a>
        <span aria-disabled="true" className="text-fg-3">
          See what changed (coming soon)
        </span>
      </div>
    </Screen>
  );
}

const FAILURE_COPY: Partial<Record<Of<"failed">["error"]["code"], [string, string]>> = {
  EXTRACTION_FAILED: ["We couldn't understand this CV or Job Description.", "Try again; if it keeps failing, try the other file format."],
  NO_REQUIREMENTS: ["We found no Requirements in this Job Description.", "Paste the full posting, including its requirements."],
  COVERAGE_FAILED: ["We couldn't compare your CV with the job.", "Try again in a moment."],
  INTERNAL: ["Something broke on our side.", "Try again in a moment."],
};

export function FailedScreen({ run }: { run: Of<"failed"> }) {
  const [headline, hint] = FAILURE_COPY[run.error.code] ?? [run.error.message, "Try again in a moment."];
  return (
    <Screen title="This Run didn't finish" status={headline}>
      <p className="text-[15px] text-fg-2">{hint}</p>
      <StartNewRun />
    </Screen>
  );
}

export function InterruptedScreen() {
  return (
    <Screen title="This Run was cut off" status="This Run was cut off by a server restart and can't continue.">
      <p className="text-[15px] text-fg-2">Start a new Run with the same files.</p>
      <StartNewRun />
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
