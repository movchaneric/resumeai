import { queryOptions, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Account } from "@resume-ai/shared";
import { getAccount, listRuns } from "@/api";

export const accountKey = ["account"] as const;
export const myRunsKey = ["myRuns"] as const;

/**
 * The signed-in Account, or `null` for a guest: `getAccount` turns the 401 into `null`, so a guest is data, not an error.
 * One set of options for every observer. Real failures (network, 5xx) are not retried here; the next focus refetches.
 */
export const accountQueryOptions = () =>
  queryOptions({ queryKey: accountKey, queryFn: getAccount, retry: false, networkMode: "always", staleTime: 30_000 });

export const myRunsQueryOptions = () =>
  queryOptions({ queryKey: myRunsKey, queryFn: listRuns, retry: false, networkMode: "always" });

export interface UseAccount {
  /** `undefined` while the first answer is pending (or failed), `null` for a guest, the Account when signed in. */
  account: Account | null | undefined;
  isPending: boolean;
}

export function useAccount(): UseAccount {
  const { data, isPending } = useQuery(accountQueryOptions());
  return { account: data, isPending };
}

/** My Runs for the next screen. Pass `enabled: false` while the person is not known to be signed in (a guest gets `401`). */
export function useMyRuns(options: { enabled?: boolean } = {}) {
  return useQuery({ ...myRunsQueryOptions(), enabled: options.enabled ?? true });
}

/** After a sign-in (in-app) succeeded: re-read the Account and My Runs. Resolves once the Account is fresh. */
export async function refreshAccount(client: QueryClient): Promise<void> {
  await client.invalidateQueries({ queryKey: myRunsKey });
  await client.invalidateQueries({ queryKey: accountKey });
}

/** After a sign-out or an Account deletion: the person is a guest now, and My Runs is not theirs to keep in the cache. */
export function clearAccount(client: QueryClient): void {
  client.setQueryData(accountKey, null);
  client.removeQueries({ queryKey: myRunsKey });
}

/** The same two helpers bound to the app's `QueryClient`. */
export function useAccountActions() {
  const client = useQueryClient();
  return { refresh: () => refreshAccount(client), clear: () => clearAccount(client) };
}
