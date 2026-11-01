import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { optionalAccount } from "@/middleware/accounts.js";
import { APP_ORIGIN, makeAuthApp } from "../fakes/authApp.js";

const { app, prisma, emails, clearAuthTables } = makeAuthApp();

const ADA = { name: "Ada Example", email: "ada@example.com", password: "correct-horse-9" };

const post = (path: string, body: object, cookie?: string) => {
  const req = request(app).post(`/api/auth${path}`).set("Origin", APP_ORIGIN);
  return (cookie ? req.set("Cookie", cookie) : req).send(body);
};
const signUp = (user = ADA) => post("/sign-up/email", user);
const signIn = (email: string, password: string) => post("/sign-in/email", { email, password });
/** Follows an emailed link: the path and query of the URL, against the test app. */
const follow = (url: string) => {
  const { pathname, search } = new URL(url);
  return request(app).get(pathname + search);
};
const cookieOf = (res: request.Response): string =>
  (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
const verify = async (email: string) => {
  await follow(emails.last("verify", email).url);
};

beforeEach(async () => {
  await clearAuthTables();
  emails.clear();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("email and password", () => {
  it("refuses sign-in before the email is verified, then signs in, and signs out", async () => {
    expect((await signUp()).status).toBe(200);
    expect(emails.sent.filter((e) => e.kind === "verify" && e.to === ADA.email)).toHaveLength(1);

    const early = await signIn(ADA.email, ADA.password);
    expect(early.status).toBe(403);
    expect(early.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect(early.headers["set-cookie"]).toBeUndefined();

    await verify(ADA.email);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: ADA.email } })).emailVerified).toBe(true);

    const signedIn = await signIn(ADA.email, ADA.password);
    expect(signedIn.status).toBe(200);
    const sessionCookie = (signedIn.headers["set-cookie"] as unknown as string[]).find((c) => c.includes("session_token"));
    expect(sessionCookie).toMatch(/HttpOnly/i);
    const cookie = cookieOf(signedIn);

    const me = await request(app).get("/account").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body).toEqual({ accountId: expect.any(String), name: ADA.name, email: ADA.email });

    expect((await post("/sign-out", {}, cookie)).status).toBe(200);
    const after = await request(app).get("/account").set("Cookie", cookie);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe("UNAUTHENTICATED");
  });

  it("refuses a 9-character password and accepts a 10-character one", async () => {
    const short = await signUp({ ...ADA, password: "123456789" });
    expect(short.status).toBe(400);
    expect(short.body.code).toBe("PASSWORD_TOO_SHORT");
    expect(await prisma.user.count()).toBe(0);

    expect((await signUp({ ...ADA, password: "1234567890" })).status).toBe(200);
    expect(await prisma.user.count()).toBe(1);
  });

  it("resets a password through the emailed link", async () => {
    await signUp();
    await verify(ADA.email);

    expect((await post("/request-password-reset", { email: ADA.email, redirectTo: `${APP_ORIGIN}/reset` })).status).toBe(200);
    const link = new URL(emails.last("reset", ADA.email).url);
    const token = link.pathname.split("/").at(-1)!;

    const reset = await post("/reset-password", { newPassword: "a-brand-new-pass", token });
    expect(reset.status).toBe(200);

    expect((await signIn(ADA.email, ADA.password)).status).toBe(401);
    expect((await signIn(ADA.email, "a-brand-new-pass")).status).toBe(200);
  });
});

describe("account middleware", () => {
  it("requireAccount answers 401 UNAUTHENTICATED without a session cookie", async () => {
    const res = await request(app).get("/account");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("optionalAccount lets a guest through with account null, and sets the Account for a signed-in person", async () => {
    const { auth } = makeAuthApp();
    const handler = optionalAccount(auth.accounts);
    const run = (cookie?: string) =>
      new Promise<unknown>((resolve, reject) => {
        const req = { headers: cookie ? { cookie } : {} } as never as import("express").Request;
        handler(req, {} as never, (error?: unknown) => (error ? reject(error) : resolve(req.account)));
      });
    expect(await run()).toBeNull();

    await signUp();
    await verify(ADA.email);
    const cookie = cookieOf(await signIn(ADA.email, ADA.password));
    expect(await run(cookie)).toMatchObject({ email: ADA.email, name: ADA.name });
  });
});
