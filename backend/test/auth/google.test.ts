import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { APP_ORIGIN, makeAuthApp } from "../fakes/authApp.js";

const google = { GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test-client-secret" };
const PROFILES: Record<string, { id: string; name: string; email: string; emailVerified: boolean }> = {
  "ada-token": { id: "google-ada", name: "Ada Example", email: "ada@example.com", emailVerified: true },
  "grace-token": { id: "google-grace", name: "Grace Example", email: "grace@example.com", emailVerified: true },
};
const { app, prisma, emails, clearAuthTables } = makeAuthApp(google, (idToken) => PROFILES[idToken]!);

const post = (path: string, body: object) => request(app).post(`/api/auth${path}`).set("Origin", APP_ORIGIN).send(body);
const googleSignIn = (token: string) => post("/sign-in/social", { provider: "google", idToken: { token } });

beforeEach(async () => {
  await clearAuthTables();
  emails.clear();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("Google sign-in", () => {
  it("builds the authorize URL with the redirect URI registered in the Google console", async () => {
    const res = await post("/sign-in/social", { provider: "google", callbackURL: "/" });
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:5173/api/auth/callback/google");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
  });

  it("links a verified same-email Google sign-in into the existing password Account", async () => {
    const password = { name: "Ada Example", email: "ada@example.com", password: "correct-horse-9" };
    await post("/sign-up/email", password);
    const { pathname, search } = new URL(emails.last("verify", password.email).url);
    await request(app).get(pathname + search);

    const res = await googleSignIn("ada-token");
    expect(res.status).toBe(200);
    expect(res.headers["set-cookie"]).toBeDefined();

    expect(await prisma.user.count()).toBe(1);
    const accounts = await prisma.authAccount.findMany({ orderBy: { providerId: "asc" } });
    expect(accounts.map((a) => a.providerId)).toEqual(["credential", "google"]);
    expect(new Set(accounts.map((a) => a.userId)).size).toBe(1);
  });

  it("does not link into a password Account whose email is not verified", async () => {
    await post("/sign-up/email", { name: "Ada Example", email: "ada@example.com", password: "correct-horse-9" });

    const res = await googleSignIn("ada-token");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("OAUTH_LINK_ERROR");
    expect(res.headers["set-cookie"]).toBeUndefined();

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.authAccount.count({ where: { providerId: "google" } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "ada@example.com" } })).emailVerified).toBe(false);
  });

  it("creates an Account for a new Google email", async () => {
    expect((await googleSignIn("grace-token")).status).toBe(200);
    expect(await prisma.user.count()).toBe(1);
    expect((await prisma.authAccount.findMany()).map((a) => a.providerId)).toEqual(["google"]);
  });
});
