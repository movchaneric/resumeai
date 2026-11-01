import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { claimStoredGuestRuns } from "@/features/account/claim";
import { myRunsKey, useAccount } from "@/features/account/queries";

/**
 * Mount once at the app root. Whenever an Account is signed in and this browser holds Guest Runs, claims them once and
 * refreshes My Runs. It keys on the Account, so it fires after an in-app sign-in and after the full page load that
 * follows a Google redirect alike. `claimStoredGuestRuns` joins an overlapping call, so StrictMode's second effect
 * run does not send twice.
 */
export function useClaimGuestRuns(): void {
  const client = useQueryClient();
  const { account } = useAccount();
  const accountId = account?.accountId;

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    void claimStoredGuestRuns().then((claimed) => {
      if (claimed && !cancelled) void client.invalidateQueries({ queryKey: myRunsKey });
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, client]);
}
