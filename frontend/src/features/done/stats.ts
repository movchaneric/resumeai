import type { RunView } from "@resume-ai/shared";

type Completed = Extract<RunView, { status: "completed" }>;

export interface DoneStats {
  rewordingsKept: number;
  bulletsAdded: number;
  mustHavesMet: number;
  mustHaves: number;
}

/** Counted only from the view: Changes the user kept (accepted or revised), and the must-have Requirements the final CV meets. */
export function doneStats(run: Completed): DoneStats {
  const kept = run.changes.filter((c) => c.status === "accepted" || c.status === "revised");
  const mustHaves = run.requirements.filter((r) => r.importance === "must_have");
  return {
    rewordingsKept: kept.filter((c) => c.op === "replace").length,
    bulletsAdded: kept.filter((c) => c.op === "add").length,
    mustHavesMet: mustHaves.filter((r) => r.after.verdict === "met").length,
    mustHaves: mustHaves.length,
  };
}

/** "3 Nov 2026": the medium date of `expiresAt`. Locale and time zone default to the browser's. */
export function formatExpiry(iso: string, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }).format(new Date(iso));
}
