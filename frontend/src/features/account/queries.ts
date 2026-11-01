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

/**
 * After a sign-out or an Account deletion: the person is a guest now. Every other cached server answer (My Runs, the Run
 * views they opened) is theirs, so none of it stays for the next person on this browser. The Account query itself is kept
 * and set to `null`, so its mounted observers (the header) switch to "Sign in" without a refetch.
 */
export function clearAccount(client: QueryClient): void {
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== accountKey[0] });
  client.setQueryData(accountKey, null);
}

/** The same two helpers bound to the app's `QueryClient`. */
export function useAccountActions() {
  const client = useQueryClient();
  return { refresh: () => refreshAccount(client), clear: () => clearAccount(client) };
}
