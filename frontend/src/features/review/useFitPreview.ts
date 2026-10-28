import { useCallback, useEffect, useRef, useState } from "react";
import type { ReviewFit, ReviewSubmission } from "@resume-ai/shared";
import { ApiError, previewReview } from "@/api";
import { initialReviewState } from "@/features/review/state";
import { toSubmission } from "@/features/review/rules";
import type { ReviewRun } from "@/features/review/types";

export const PREVIEW_DEBOUNCE_MS = 600;

/**
 * Why a preview failed. `invalid`: the server (400 `INVALID_REVIEW`) named a Change or an Item; `unreachable` and
 * `failed` both read "Couldn't check the fit" with Retry.
 */
export type FitPreviewError =
  | { kind: "invalid"; message: string; changeId: string | null; itemId: string | null }
  | { kind: "unreachable" | "failed"; message: string };

const TOKEN = /[A-Za-z0-9_](?:[\w.-]*[A-Za-z0-9_])?/g;

/**
 * The Change and Item an `INVALID_REVIEW` message names. The backend sends no `details` for it, only a message such as
 * "Decision for c3: ..." or "Drop b1: reject its Change c2 to drop it.", so the message is read for whole words that are
 * a known Change ID or an ID in the Run's CV (a decision or drop is all the client can send, so the IDs are known).
 */
export function invalidReviewTarget(message: string, run: Pick<ReviewRun, "changes">, submission: ReviewSubmission): { changeId: string | null; itemId: string | null } {
  const changeIds = new Set(run.changes.map((c) => c.id as string));
  const itemIds = new Set<string>(submission.drops);
  for (const c of run.changes) {
    if (c.op === "replace" || c.op === "remove") itemIds.add(c.targetItemId);
    if (c.op === "add" || c.op === "reorder") itemIds.add(c.parentId);
  }
  let changeId: string | null = null;
  let itemId: string | null = null;
  for (const word of message.match(TOKEN) ?? []) {
    if (changeId === null && changeIds.has(word)) changeId = word;
    else if (itemId === null && itemIds.has(word) && !changeIds.has(word)) itemId = word;
  }
  return { changeId, itemId };
}

function toPreviewError(error: unknown, run: ReviewRun, submission: ReviewSubmission): FitPreviewError {
  if (error instanceof ApiError) {
    if (error.status === 400 && error.code === "INVALID_REVIEW") return { kind: "invalid", message: error.message, ...invalidReviewTarget(error.message, run, submission) };
    return { kind: error.isNetworkError ? "unreachable" : "failed", message: error.message };
  }
  return { kind: "failed", message: "Couldn't check the fit." };
}

export interface FitPreview {
  /** The last fit known: the view's `fit` until a preview answers. */
  fit: ReviewFit;
  /** A preview is waiting out the debounce or in flight. */
  checking: boolean;
  /** Set when the last preview failed; `fit` is then the one before it. */
  error: FitPreviewError | null;
  /** Runs the preview again at once. */
  retry: () => void;
  /** Replaces the fit, for example with the one a 400 `CV_TOO_LONG` reports at submit. */
  setFit: (fit: ReviewFit) => void;
}

/**
 * The fit of the Review as it stands. It starts from the view's `fit` with no call (and returns to it, with no call, when
 * the choices match the starting ones again). Each change after that waits 600ms, then calls the preview; a newer change
 * aborts the one in flight. An abort is never an error.
 */
export function useFitPreview(run: ReviewRun, state: Parameters<typeof toSubmission>[0]): FitPreview {
  const submission = toSubmission(state);
  const key = JSON.stringify(submission);
  const baseKey = JSON.stringify(toSubmission(initialReviewState(run)));
  const submissionRef = useRef(submission);
  submissionRef.current = submission;
  const runRef = useRef(run);
  runRef.current = run;

  const [fit, setFit] = useState<ReviewFit>(run.fit);
  const [checking, setChecking] = useState(key !== baseKey);
  const [error, setError] = useState<FitPreviewError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const immediate = useRef(false);

  useEffect(() => {
    if (key === baseKey) {
      setFit(runRef.current.fit);
      setChecking(false);
      setError(null);
      return;
    }
    setChecking(true);
    const controller = new AbortController();
    const delay = immediate.current ? 0 : PREVIEW_DEBOUNCE_MS;
    immediate.current = false;
    const sent = submissionRef.current;
    const timer = setTimeout(() => {
      previewReview(runRef.current.id, sent, controller.signal).then(
        (next) => {
          if (controller.signal.aborted) return;
          setFit(next);
          setError(null);
          setChecking(false);
        },
        (failure: unknown) => {
          if (controller.signal.aborted) return;
          setError(toPreviewError(failure, runRef.current, sent));
          setChecking(false);
        },
      );
    }, delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, baseKey, attempt]);

  const retry = useCallback(() => {
    immediate.current = true;
    setAttempt((n) => n + 1);
  }, []);

  return { fit, checking, error, retry, setFit };
}
