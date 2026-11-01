import { MAX_CLAIM_IDS, type ClaimRunItem } from "@resume-ai/shared";

/** A Guest Run this browser started: what `POST /runs` returned, and when. */
export interface StoredGuestRun extends ClaimRunItem {
  /** Epoch milliseconds. */
  createdAt: number;
}

const KEY = "resume-ai.guestRuns";
/** Guest Runs expire on the server long before this; an older entry can never be claimed. */
export const GUEST_RUN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function load(): unknown {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function save(runs: StoredGuestRun[]): void {
  try {
    if (runs.length === 0) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(runs));
  } catch {
    // Storage is missing, full or blocked: the app works, the Run just cannot be claimed later.
  }
}

/** The usable entries: well-formed, not older than 7 days, newest first, at most `MAX_CLAIM_IDS`. */
function clean(value: unknown, now: number): StoredGuestRun[] {
  if (!Array.isArray(value)) return [];
  const runs = value.filter(
    (v): v is StoredGuestRun =>
      !!v && typeof v === "object" && typeof v.id === "string" && v.id !== "" && typeof v.claimToken === "string" && v.claimToken !== "" && typeof v.createdAt === "number" && now - v.createdAt <= GUEST_RUN_MAX_AGE_MS,
  );
  return runs.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_CLAIM_IDS);
}

/** The Guest Runs this browser started and has not yet handed to an Account, newest first. Never throws. */
export function readGuestRuns(now: number = Date.now()): StoredGuestRun[] {
  return clean(load(), now);
}

/** Remembers a Guest Run. Does nothing without a claim token (an Owned Run has none). Never throws. */
export function addGuestRun(run: { id: string; claimToken?: string | undefined }, now: number = Date.now()): void {
  if (!run.claimToken) return;
  const others = readGuestRuns(now).filter((r) => r.id !== run.id);
  save(clean([{ id: run.id, claimToken: run.claimToken, createdAt: now }, ...others], now));
}

/** Forgets the given Guest Runs. Never throws. */
export function removeGuestRuns(ids: readonly string[], now: number = Date.now()): void {
  const gone = new Set(ids);
  save(readGuestRuns(now).filter((r) => !gone.has(r.id)));
}
