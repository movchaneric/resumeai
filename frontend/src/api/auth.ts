import { z } from "zod";
import { jsonBody, requestJson } from "@/api/http";

/*
 * Better Auth's endpoints under `/api/auth`, called with plain fetches (the `better-auth` package stays in the backend).
 * Failures arrive as `ApiError` with Better Auth's own `code` (`INVALID_EMAIL_OR_PASSWORD`, `EMAIL_NOT_VERIFIED`,
 * `PASSWORD_TOO_SHORT`, `INVALID_TOKEN`, `OAUTH_LINK_ERROR`, ...), and `RATE_LIMITED` for a 429.
 *
 * Every callback URL is a same-origin path (`/verify-email?next=%2Fruns`): Better Auth accepts a relative path that
 * starts with a single `/`, has no backslash and no encoded `/` or `\` in the path part (the query may hold them).
 * Build them with `safeNext`-checked values only.
 */

const UserRefSchema = z.object({ id: z.string() });
const StatusSchema = z.object({ status: z.boolean() });

const SignUpResponseSchema = z.object({ user: UserRefSchema });
const SignInResponseSchema = z.object({ user: UserRefSchema });
const SignOutResponseSchema = z.object({ success: z.boolean() });
const SocialResponseSchema = z.object({ url: z.string().min(1) });

const AUTH = "/auth";

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
  /** Where the emailed verification link sends the browser afterwards (a same-origin path); on failure it appends `?error=INVALID_TOKEN` or `TOKEN_EXPIRED`. */
  callbackURL: string;
}

/**
 * `POST /sign-up/email`. With required verification it never signs in: it sends the verification email and answers `200`.
 * An already-used email answers the same `200` (no email is sent, so a screen cannot tell the two apart; that is deliberate).
 * A password under 10 characters is `400 PASSWORD_TOO_SHORT`.
 */
export async function signUpWithEmail(input: SignUpInput): Promise<void> {
  await requestJson(`${AUTH}/sign-up/email`, SignUpResponseSchema, jsonBody(input));
}

/** `POST /sign-in/email`. `401 INVALID_EMAIL_OR_PASSWORD`, or `403 EMAIL_NOT_VERIFIED` (no session is created). On success the session cookie is set. */
export async function signInWithEmail(input: { email: string; password: string }): Promise<void> {
  await requestJson(`${AUTH}/sign-in/email`, SignInResponseSchema, jsonBody(input));
}

/** `POST /sign-out`: clears the session cookie. */
export async function signOut(): Promise<void> {
  await requestJson(`${AUTH}/sign-out`, SignOutResponseSchema, jsonBody({}));
}

export interface GoogleSignInInput {
  /** Same-origin path to land on after a sign-in. */
  callbackURL: string;
  /** Where a failed sign-in lands, with `?error=<code>` (for example `account_not_linked` or `email_not_verified`). */
  errorCallbackURL: string;
  /** Where a first-time Google sign-in lands. */
  newUserCallbackURL: string;
}

/** `POST /sign-in/social` for Google. Returns Google's authorize URL; the caller does `window.location.assign(url)`. */
export async function googleSignInUrl(input: GoogleSignInInput): Promise<string> {
  return (await requestJson(`${AUTH}/sign-in/social`, SocialResponseSchema, jsonBody({ provider: "google", ...input }))).url;
}

/**
 * `POST /send-verification-email`: resends the link. Always `200` for a signed-out caller, whether or not the email
 * exists or is already verified (nothing is sent in those cases).
 */
export async function sendVerificationEmail(input: { email: string; callbackURL: string }): Promise<void> {
  await requestJson(`${AUTH}/send-verification-email`, StatusSchema, jsonBody(input));
}

/**
 * `POST /request-password-reset`: always `200`, whether or not the email has an Account. The emailed link goes through
 * Better Auth and lands on `redirectTo` with `?token=<token>`, or `?error=INVALID_TOKEN` when it is bad or expired.
 */
export async function requestPasswordReset(input: { email: string; redirectTo: string }): Promise<void> {
  await requestJson(`${AUTH}/request-password-reset`, StatusSchema, jsonBody(input));
}

/** `POST /reset-password`: `400 INVALID_TOKEN` for a bad, used or expired token, `400 PASSWORD_TOO_SHORT` under 10 characters. Does not sign in. */
export async function resetPassword(input: { newPassword: string; token: string }): Promise<void> {
  await requestJson(`${AUTH}/reset-password`, StatusSchema, jsonBody(input));
}
