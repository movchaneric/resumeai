import { useEffect, useState } from "react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RunView } from "@resume-ai/shared";
import { ApiError, getRun, openRunStream } from "@/api";

export const runKey = (id: string) => ["run", id] as const;

/**
 * One set of query options for every observer of a Run: a query keeps a single `retry` and `networkMode`, so two observers
 * with different ones would overwrite each other. No retries: while the Run is working the polling is the retry, and a
 * failed first load shows a "Try again" button.
 */
const runQueryOptions = (id: string) =>
  queryOptions({ queryKey: runKey(id), queryFn: () => getRun(id), networkMode: "always", retry: false });

/** The statuses in which the Run is working and the server pushes views. */
const ACTIVE = new Set<RunView["status"]>(["parsing", "extracting", "tailoring"]);
export const isActive = (run: RunView | undefined): boolean => run !== undefined && ACTIVE.has(run.status);

export const POLL_MS = 3000;
export const FAILURES_BEFORE_NOTICE = 3;

export interface UseRun {
  run: RunView | undefined;
  /** Set only when there is no view to show: a 404, a response that did not parse, or a failed first load. */
  error: ApiError | null;
  /** Three failures in a row (stream or polling): the screen shows "Lost connection. Retrying…". */
  lostConnection: boolean;
  retry: () => void;
}

/**
 * The Run as a query. While it is parsing, extracting or tailoring, an EventSource writes each view into the cache. If the
 * stream breaks, polling every 3s takes over until the Run settles. Three failures in a row set `lostConnection`.
 */
export function useRun(id: string): UseRun {
  const client = useQueryClient();
  const [streamDown, setStreamDown] = useState(false);
  const [failures, setFailures] = useState(0);

  const query = useQuery({
    ...runQueryOptions(id),
    refetchInterval: (q) => (isActive(q.state.data) && streamDown ? POLL_MS : false),
  });

  const active = isActive(query.data);

  useEffect(() => {
    if (!active) {
      setStreamDown(false);
      return;
    }
    if (streamDown) return;
    return openRunStream(id, {
      onView: (view) => {
        client.setQueryData(runKey(id), view);
        setFailures(0);
      },
      onError: () => {
        setStreamDown(true);
        setFailures((n) => n + 1);
        void client.invalidateQueries({ queryKey: runKey(id) });
      },
    });
  }, [id, active, streamDown, client]);

  useEffect(() => {
    if (query.errorUpdateCount > 0) setFailures((n) => n + 1);
  }, [query.errorUpdateCount]);

  useEffect(() => {
    if (query.dataUpdatedAt > 0) setFailures(0);
  }, [query.dataUpdatedAt]);

  const error = query.data ? null : query.error instanceof ApiError ? query.error : query.error ? new ApiError(0, "INTERNAL", "Something went wrong.") : null;
  return { run: query.data, error, lostConnection: failures >= FAILURES_BEFORE_NOTICE, retry: () => void query.refetch() };
}

/** Reads the Run from the cache without fetching or streaming (the app shell's job line). */
export function useCachedRun(id: string | undefined): RunView | undefined {
  const { data } = useQuery({ ...runQueryOptions(id ?? ""), enabled: false });
  return id ? data : undefined;
}
