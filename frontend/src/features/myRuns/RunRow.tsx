import { useState } from "react";
import { Link } from "react-router";
import type { RunSummary } from "@resume-ai/shared";
import { DownloadLink } from "@/features/done/DownloadLink";
import { formatExpiry } from "@/features/done/stats";
import { DeleteOwnedRunDialog } from "@/features/myRuns/DeleteOwnedRunDialog";
import { STAGE_LABEL, STAGE_OF, type RunStage } from "@/features/myRuns/status";
import { Button } from "@/ui/Button";
import { Chip, type ChipVariant } from "@/ui/Chip";

const STAGE_CHIP: Record<RunStage, ChipVariant> = {
  answering: "badge",
  in_progress: "status",
  in_review: "badge",
  done: "delta",
  failed: "warn",
};

/** One Owned Run: the job, when it started, its stage and score, and what you can do with it. */
export function RunRow({ run, onDownloadError }: { run: RunSummary; onDownloadError: (error: unknown) => void }) {
  const [deleting, setDeleting] = useState(false);
  const stage = STAGE_OF[run.status];
  const title = run.jobTitle ?? "Untitled job";
  return (
    <li className="flex flex-col gap-3 rounded-hero bg-surface p-4 ring-1 ring-line sm:flex-row sm:items-center sm:justify-between md:p-5">
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="truncate font-bold">{title}</p>
        <p className="truncate text-sm text-fg-2">
          {run.company ? `${run.company} · ` : ""}
          <time dateTime={run.createdAt}>{formatExpiry(run.createdAt)}</time>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Chip variant={STAGE_CHIP[stage]}>{STAGE_LABEL[stage]}</Chip>
          {run.matchScore !== null && <Chip>Match {run.matchScore}</Chip>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/runs/${run.id}`}
          aria-label={`Open ${title}`}
          className="inline-flex min-h-10 items-center rounded-btn bg-fg px-4 text-sm font-semibold text-surface transition-colors duration-150 hover:bg-fg-2"
        >
          Open
        </Link>
        {stage === "done" && (
          <>
            <DownloadLink runId={run.id} format="pdf" variant="secondary" label="Download PDF" onError={onDownloadError} compact />
            <DownloadLink runId={run.id} format="docx" variant="secondary" label="Download DOCX" onError={onDownloadError} compact />
          </>
        )}
        <Button variant="danger" aria-label={`Delete ${title}`} onClick={() => setDeleting(true)}>
          Delete
        </Button>
      </div>
      <DeleteOwnedRunDialog runId={run.id} open={deleting} onOpenChange={setDeleting} />
    </li>
  );
}
