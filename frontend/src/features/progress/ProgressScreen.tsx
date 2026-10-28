import { useEffect, useRef, useState } from "react";
import { Check, Circle, CircleDot, Loader2, X } from "lucide-react";
import type { RunView } from "@resume-ai/shared";
import { StartNewRun, Screen } from "@/features/run/screens";
import { EXPLANATION, stepRows, type StepRow } from "@/features/progress/steps";
import { useReducedMotion } from "@/features/progress/useReducedMotion";
import { Chip } from "@/ui/Chip";
import { cx } from "@/ui/cx";

type Of<S extends RunView["status"]> = Extract<RunView, { status: S }>;
type Working = Of<"parsing"> | Of<"extracting"> | Of<"tailoring">;

const LEAD = "You can leave this page. Your Run keeps going, and the link above brings you back to it for 7 days.";

const roundOf = (run: Of<"tailoring">) => `Round ${Math.min(run.iterations.used + 1, run.iterations.max)} of ${run.iterations.max}`;

/** What the status region says while the Run works: the running step, with its round while tailoring. */
function stepAnnouncement(run: Working): string {
  if (run.status === "parsing") return "Reading your CV.";
  if (run.status === "extracting") return "Reading the Job Description.";
  return `Tailoring, ${roundOf(run).toLowerCase()}.`;
}

/**
 * The status region announces a step change at once, and the score only when a round ends (`iterations.used` goes up),
 * never on every update.
 */
function useAnnouncement(run: Working): string {
  const step = stepAnnouncement(run);
  const used = run.status === "tailoring" ? run.iterations.used : null;
  const after = run.status === "tailoring" ? run.score.after : null;
  const before = run.status === "tailoring" ? run.score.before : null;
  const [roundEnd, setRoundEnd] = useState<{ step: string; text: string } | null>(null);
  const lastUsed = useRef(used);
  useEffect(() => {
    if (used !== null && lastUsed.current !== null && used > lastUsed.current && before !== null && after !== null) {
      setRoundEnd({ step, text: `Round ${used} finished. Match Score ${Math.round(before)} to ${Math.round(after)}.` });
    }
    lastUsed.current = used;
  }, [used, before, after, step]);
  // The round-end sentence stays until the step text changes again.
  return roundEnd && roundEnd.step === step ? roundEnd.text : step;
}

function StepIcon({ state }: { state: StepRow["state"] }) {
  const reduced = useReducedMotion();
  if (state === "done") return <Check aria-hidden="true" size={18} strokeWidth={2.5} className="text-ok" />;
  if (state === "failed") return <X aria-hidden="true" size={18} strokeWidth={2.5} className="text-danger" />;
  if (state === "running") {
    return reduced ? (
      <CircleDot aria-hidden="true" data-testid="static-icon" size={18} strokeWidth={2.5} className="text-accent" />
    ) : (
      <Loader2 aria-hidden="true" data-testid="spinner" size={18} strokeWidth={2.5} className="animate-spin text-accent" />
    );
  }
  return <Circle aria-hidden="true" size={18} strokeWidth={2} />;
}

const STATE_LABEL: Record<StepRow["state"], string> = { done: "Done", running: "In progress", pending: "Not started", failed: "Failed" };

function StepList({ rows }: { rows: StepRow[] }) {
  return (
    <ol className="flex flex-col gap-1" aria-label="Steps">
      {rows.map((row) => (
        <li
          key={row.key}
          className={cx(
            "flex flex-col gap-0.5 rounded-btn px-3 py-2",
            row.state === "running" && "bg-accent-soft text-fg",
            row.state === "done" && "text-fg-2",
            row.state === "pending" && "text-fg-3",
            row.state === "failed" && "text-danger",
          )}
        >
          <div className="flex items-center gap-3">
            <StepIcon state={row.state} />
            <span className="font-semibold">{row.label}</span>
            <span className="sr-only">{STATE_LABEL[row.state]}</span>
          </div>
          {row.state === "running" && EXPLANATION[row.key] && <p className="pl-[30px] text-sm text-fg-2">{EXPLANATION[row.key]}</p>}
        </li>
      ))}
    </ol>
  );
}

function Score({ run }: { run: Of<"tailoring"> }) {
  const { before, after } = run.score;
  const delta = after === null ? null : Math.round(after - before);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm font-semibold text-fg-3">Match Score</span>
      <span className="text-2xl font-bold tabular-nums">{Math.round(before)}</span>
      <span aria-hidden="true">→</span>
      <span className="text-2xl font-bold tabular-nums">{after === null ? "—" : Math.round(after)}</span>
      {delta !== null && delta > 0 && <Chip variant="delta">+{delta}</Chip>}
      <span className="ml-auto text-sm text-fg-3">{roundOf(run)}</span>
    </div>
  );
}

const Card = ({ children }: { children: React.ReactNode }) => (
  <div className="flex flex-col gap-4 rounded-hero bg-surface p-5 ring-1 ring-line">{children}</div>
);

/** Parsing, extracting and tailoring: the step list, and the Match Score so far once tailoring starts. */
export function ProgressScreen({ run, notice }: { run: Working; notice: string }) {
  const announcement = useAnnouncement(run);
  const title = run.status === "parsing" ? "Reading your CV…" : "Tailoring your CV";
  return (
    <Screen title={title} lead={LEAD} status={notice || announcement}>
      <Card>
        {run.status === "tailoring" && <Score run={run} />}
        <StepList rows={stepRows(run.steps)} />
      </Card>
    </Screen>
  );
}

const FAILURE_COPY: Partial<Record<Of<"failed">["error"]["code"], [string, string]>> = {
  EXTRACTION_FAILED: ["We couldn't understand this CV or Job Description.", "Try again; if it keeps failing, try the other file format."],
  NO_REQUIREMENTS: ["We found no Requirements in this Job Description.", "Paste the full posting, including its requirements."],
  COVERAGE_FAILED: ["We couldn't compare your CV with the job.", "Try again in a moment."],
  INTERNAL: ["Something broke on our side.", "Try again in a moment."],
};

/** The step list marks the step that broke; a card gives the message for the error code. */
export function FailedScreen({ run }: { run: Of<"failed"> }) {
  const [headline, hint] = FAILURE_COPY[run.error.code] ?? [run.error.message, "Try again in a moment."];
  const rows = stepRows(run.steps);
  return (
    <Screen title="This Run didn't finish" status={headline}>
      {rows.length > 0 && (
        <Card>
          <StepList rows={rows} />
        </Card>
      )}
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
