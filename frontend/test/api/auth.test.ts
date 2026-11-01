import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ApiError, googleSignInUrl, requestPasswordReset, resetPassword, sendVerificationEmail, signInWithEmail, signOut, signUpWithEmail } from "@/api";
import { server } from "../helpers/server";

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

/** Answers a POST and records the JSON it got. */
function serve(path: string, response: () => Response) {
  const seen: { body?: unknown } = {};
  server.use(http.post(path, async ({ request }) => ((seen.body = await request.json()), response())));
  return seen;
}

describe("auth api", () => {
  it("signUpWithEmail posts name, email, password and callbackURL to /api/auth/sign-up/email", async () => {
    const seen = serve("/api/auth/sign-up/email", () => HttpResponse.json({ token: null, user: { id: "u1", email: "ada@example.com" } }));
    const input = { name: "Ada Example", email: "ada@example.com", password: "correct-horse-9", callbackURL: "/verify-email?next=%2Fruns" };
    await signUpWithEmail(input);
    expect(seen.body).toEqual(input);
  });

  it("maps Better Auth errors to ApiError codes", async () => {
    serve("/api/auth/sign-up/email", () => HttpResponse.json({ code: "PASSWORD_TOO_SHORT", message: "Password too short" }, { status: 400 }));
    expect(await failure(signUpWithEmail({ name: "A", email: "a@example.com", password: "123", callbackURL: "/" }))).toMatchObject({ status: 400, code: "PASSWORD_TOO_SHORT" });

    serve("/api/auth/sign-in/email", () => HttpResponse.json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, { status: 401 }));
    expect(await failure(signInWithEmail({ email: "a@example.com", password: "x" }))).toMatchObject({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" });

    serve("/api/auth/sign-in/email", () => HttpResponse.json({ code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }, { status: 403 }));
    expect(await failure(signInWithEmail({ email: "a@example.com", password: "x" }))).toMatchObject({ status: 403, code: "EMAIL_NOT_VERIFIED" });

    serve("/api/auth/reset-password", () => HttpResponse.json({ code: "INVALID_TOKEN", message: "Invalid token" }, { status: 400 }));
    expect(await failure(resetPassword({ newPassword: "a-brand-new-pass", token: "t" }))).toMatchObject({ status: 400, code: "INVALID_TOKEN" });
  });

  it("maps a 429 without a code to RATE_LIMITED, with the wait when given", async () => {
    serve("/api/auth/sign-in/email", () => HttpResponse.json({ message: "Too many requests. Please try again later." }, { status: 429, headers: { "X-Retry-After": "7" } }));
    expect(await failure(signInWithEmail({ email: "a@example.com", password: "x" }))).toMatchObject({ status: 429, code: "RATE_LIMITED", details: { retryAfterSeconds: 7 } });
  });

  it("signInWithEmail posts email and password", async () => {
    const seen = serve("/api/auth/sign-in/email", () => HttpResponse.json({ redirect: false, token: "t", user: { id: "u1" } }));
    await signInWithEmail({ email: "ada@example.com", password: "correct-horse-9" });
    expect(seen.body).toEqual({ email: "ada@example.com", password: "correct-horse-9" });
  });

  it("signOut posts to /api/auth/sign-out", async () => {
    const seen = serve("/api/auth/sign-out", () => HttpResponse.json({ success: true }));
    await signOut();
    expect(seen.body).toEqual({});
  });

  it("googleSignInUrl returns the authorize URL and sends the three callbacks", async () => {
    const seen = serve("/api/auth/sign-in/social", () => HttpResponse.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", redirect: true }));
    const input = { callbackURL: "/runs", errorCallbackURL: "/sign-in", newUserCallbackURL: "/runs" };
    expect(await googleSignInUrl(input)).toBe("https://accounts.google.com/o/oauth2/v2/auth?x=1");
    expect(seen.body).toEqual({ provider: "google", ...input });
  });

  it("sendVerificationEmail, requestPasswordReset and resetPassword send their bodies", async () => {
    const a = serve("/api/auth/send-verification-email", () => HttpResponse.json({ status: true }));
    await sendVerificationEmail({ email: "ada@example.com", callbackURL: "/verify-email" });
    expect(a.body).toEqual({ email: "ada@example.com", callbackURL: "/verify-email" });

    const b = serve("/api/auth/request-password-reset", () => HttpResponse.json({ status: true, message: "check your email" }));
    await requestPasswordReset({ email: "ada@example.com", redirectTo: "/reset-password" });
    expect(b.body).toEqual({ email: "ada@example.com", redirectTo: "/reset-password" });

    const c = serve("/api/auth/reset-password", () => HttpResponse.json({ status: true }));
    await resetPassword({ newPassword: "a-brand-new-pass", token: "tok" });
    expect(c.body).toEqual({ newPassword: "a-brand-new-pass", token: "tok" });
  });

  it("a response of the wrong shape is a parse error", async () => {
    serve("/api/auth/sign-in/social", () => HttpResponse.json({ nope: 1 }));
    expect((await failure(googleSignInUrl({ callbackURL: "/", errorCallbackURL: "/", newUserCallbackURL: "/" }))).isParseError).toBe(true);
  });
});
