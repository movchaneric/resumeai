import { ApiError } from "@/api";

/** Google sign-in errors that mean "this email already has an account that is not verified or not linked". */
const GOOGLE_UNVERIFIED = new Set(["account_not_linked", "email_not_verified", "unable_to_link_account"]);

export const GOOGLE_UNVERIFIED_MESSAGE = "This email has an account that isn't verified yet. Open the link we emailed you, then continue with Google.";
export const GOOGLE_FAILED_MESSAGE = "Couldn't sign in with Google. Try again, or use your email and password.";
export const FALLBACK_MESSAGE = "Something went wrong. Try again.";
export const RATE_LIMITED_MESSAGE = "Too many tries. Wait a minute, then try again.";

/** The line for `/sign-in?error=<code>` (Google's callback), or null when there is no error. */
export function googleErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return GOOGLE_UNVERIFIED.has(code.toLowerCase()) ? GOOGLE_UNVERIFIED_MESSAGE : GOOGLE_FAILED_MESSAGE;
}

export const errorCode = (e: unknown): string | undefined => (e instanceof ApiError ? e.code : undefined);
