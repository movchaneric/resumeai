import { useState } from "react";
import { Link } from "react-router";
import { Check } from "lucide-react";
import type { RunView } from "@resume-ai/shared";
import { ApiError } from "@/api";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { DeleteRunDialog } from "@/features/run/DeleteRunDialog";
import { DownloadLink } from "@/features/done/DownloadLink";
import { doneStats, formatExpiry } from "@/features/done/stats";

type Completed = Extract<RunView, { status: "completed" }>;

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-hero bg-surface p-4 ring-1 ring-line">
      <dd className="text-2xl font-bold tabular-nums">{value}</dd>
      <dt className="text-sm text-fg-2">{label}</dt>
    </div>
  );
}

function jobLine(job: Completed["job"]): string {
  if (!job) return "";
  if (job.title && job.company) return `${job.title} at ${job.company}`;
  return job.title ?? job.company ?? "";
}

export function DoneScreen({ run, notice }: { run: Completed; notice: string }) {
  const [deleting, setDeleting] = useState(false);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const before = Math.round(run.score.before);
  const after = Math.round(run.score.after);
  const delta = after - before;
  const stats = doneStats(run);
  const tooLong = downloadError instanceof ApiError && downloadError.code === "CV_TOO_LONG";

  return (
    <section className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-6 px-4 py-10 text-center md:px-6">
      <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-ok text-surface">
        <Check size={28} strokeWidth={2.5} />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight">Your tailored CV is ready</h1>
        <p className="text-[15px] text-fg-2">
          {[jobLine(run.job), "one page"].filter(Boolean).join(" · ")}
        </p>
      </div>
      <p role="status" className="sr-only">
        {notice || "Your tailored CV is ready to download."}
      </p>

      <div className="flex flex-col items-center gap-2">
        <div className="flex flex-wrap items-baseline justify-center gap-3">
          <span className="text-2xl text-fg-3 tabular-nums">{before}</span>
          <span aria-hidden="true" className="text-fg-3">
            →
          </span>
          <span className="text-[64px] leading-none font-bold tabular-nums">{after}</span>
          <Chip variant={delta > 0 ? "delta" : "status"}>{delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : "0"}</Chip>
        </div>
        <p className="text-sm text-fg-3">Match Score, before and after</p>
        {delta <= 0 && (
          <p className="max-w-[460px] text-[15px] text-fg-2">
            Your Review kept fewer of the Changes, so the score moved less. The CV still says only what's true.
          </p>
        )}
      </div>

      <div className="flex w-full flex-col gap-3 sm:flex-row">
        <DownloadLink runId={run.id} format="pdf" variant="primary" label="Download PDF" onError={setDownloadError} />
        <DownloadLink runId={run.id} format="docx" variant="secondary" label="Download Word" onError={setDownloadError} />
      </div>
      {downloadError !== null && (
        <div role="alert" className="rounded-hero bg-warn-soft p-4 text-left text-[15px] text-warn-fg ring-1 ring-warn-line">
          {tooLong ? (
            <>
              <p className="font-semibold">This CV can't fit on one page with your choices.</p>
              <p>Download it anyway as Word, or start a new Run with a shorter CV.</p>
            </>
          ) : (
            <p className="font-semibold">Couldn't download the CV. Try again.</p>
          )}
        </div>
      )}

      <dl className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile value={String(stats.rewordingsKept)} label="rewordings kept" />
        <Tile value={String(stats.bulletsAdded)} label="bullets added" />
        <Tile value={`${stats.mustHavesMet}/${stats.mustHaves}`} label="must-haves met" />
      </dl>

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1">
        <span aria-disabled="true" className="font-semibold text-fg-3">
          See what changed (coming soon)
        </span>
        <Link to="/" className="font-semibold text-accent underline">
          Tailor for another job
        </Link>
        <Button variant="danger" onClick={() => setDeleting(true)}>
          Delete this Run now
        </Button>
      </div>
      <DeleteRunDialog runId={run.id} open={deleting} onOpenChange={setDeleting} />

      <p className="text-sm text-fg-3">Deleted automatically on {formatExpiry(run.expiresAt)}.</p>
    </section>
  );
}
