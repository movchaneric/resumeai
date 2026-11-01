import { MAX_CLAIM_IDS } from "@resume-ai/shared";
import { ApiError, claimRuns } from "@/api";
import { readGuestRuns, removeGuestRuns } from "@/features/account/guestRuns";

const CHUNK = MAX_CLAIM_IDS;

let inFlight: Promise<boolean> | null = null;

/** A network error, a 5xx, or a 401 (signed out meanwhile) may work later; any other 4xx never will. */
function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.isNetworkError || error.status >= 500 || error.status === 401 || error.status === 0;
}

async function claimAll(): Promise<boolean> {
  const stored = readGuestRuns();
  let sent = false;
  for (let i = 0; i < stored.length; i += CHUNK) {
    const chunk = stored.slice(i, i + CHUNK);
    try {
      await claimRuns(chunk.map(({ id, claimToken }) => ({ id, claimToken })));
    } catch (error) {
      if (isRetryable(error)) return sent; // keep this chunk and the rest for the next sign-in or page load
      // Any other 4xx would fail forever: drop this chunk and go on with the rest.
      removeGuestRuns(chunk.map((r) => r.id));
      continue;
    }
    // The server claims only the valid ones, and an invalid token never becomes valid, so every sent entry goes.
    removeGuestRuns(chunk.map((r) => r.id));
    sent = true;
  }
  return sent;
}

/**
 * Hands the stored Guest Runs to the signed-in Account, 50 at a time. Resolves true when at least one request succeeded
 * (My Runs may have changed). Calls overlap safely: a second call while one runs joins it. Never rejects.
 */
export function claimStoredGuestRuns(): Promise<boolean> {
  inFlight ??= claimAll().finally(() => {
    inFlight = null;
  });
  return inFlight;
}
