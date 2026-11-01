import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CHECKPOINT_TABLES, createCheckpointDb } from "../fakes/checkpointDb.js";
import { APP_ORIGIN, makeAuthApp } from "../fakes/authApp.js";

// Real Better Auth, real Postgres checkpointer: deleting an Account leaves nothing of it behind.

const { checkpointer, rowsFor, end: endCheckpointDb } = createCheckpointDb(process.env.DATABASE_URL!);
const { app, prisma, store, clearAuthTables, signUpAndIn, startRun, emails } = makeAuthApp({}, undefined, { checkpointer });

const ADA = { name: "Ada Example", email: "ada@example.com", password: "correct-horse-9" };
const GRACE = { name: "Grace Example", email: "grace@example.com", password: "battery-staple-9" };

const expectThread = async (id: string, present: boolean) => {
  for (const table of CHECKPOINT_TABLES) {
    if (present) expect(await rowsFor(table, id), table).toBeGreaterThan(0);
    else expect(await rowsFor(table, id), table).toBe(0);
  }
};

beforeAll(async () => {
  await checkpointer.setup();
});
beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await store.deleteAll();
  await clearAuthTables();
  emails.clear();
});
afterAll(async () => {
  await store.deleteAll();
  await clearAuthTables();
  await endCheckpointDb();
  await prisma.$disconnect();
});

describe("DELETE /account", () => {
  it("removes the Account, its sessions, linked accounts, Runs (expired ones too) and checkpoints, and touches nothing else", async () => {
    const ada = await signUpAndIn(ADA);
    const grace = await signUpAndIn(GRACE);
    const adaId = (await prisma.user.findUniqueOrThrow({ where: { email: ADA.email } })).id;
    const graceId = (await prisma.user.findUniqueOrThrow({ where: { email: GRACE.email } })).id;

    const first = await startRun(ada);
    const second = await startRun(ada);
    const expired = await startRun(ada);
    await prisma.run.update({ where: { id: expired }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const graces = await startRun(grace);
    const guest = await startRun();
    for (const id of [first, second, expired, graces, guest]) await expectThread(id, true);
    // A pending password reset (Better Auth keys it `reset-password:<token>`, with the user id as value), and a row keyed by the email.
    expect((await request(app).post("/api/auth/request-password-reset").set("Origin", APP_ORIGIN).send({ email: ADA.email })).status).toBe(200);
    await prisma.verification.create({ data: { id: randomUUID(), identifier: ADA.email, value: "other", expiresAt: new Date(Date.now() + 60_000) } });
    await request(app).post("/api/auth/request-password-reset").set("Origin", APP_ORIGIN).send({ email: GRACE.email });
    expect(await prisma.verification.count({ where: { identifier: { startsWith: "reset-password:" }, value: adaId } })).toBe(1);
    const graceResets = await prisma.verification.count({ where: { identifier: { startsWith: "reset-password:" }, value: graceId } });
    expect(graceResets).toBe(1);

    const res = await request(app).delete("/account").set("Cookie", ada);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");

    expect(await prisma.run.count({ where: { accountId: adaId } })).toBe(0);
    for (const id of [first, second, expired]) {
      expect(await store.get(id)).toBeNull();
      await expectThread(id, false);
    }
    expect(await prisma.user.count({ where: { id: adaId } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: adaId } })).toBe(0);
    expect(await prisma.authAccount.count({ where: { userId: adaId } })).toBe(0);
    expect(await prisma.verification.count({ where: { OR: [{ identifier: ADA.email }, { value: adaId }] } })).toBe(0);
    expect(await prisma.verification.count({ where: { value: graceId } })).toBe(graceResets);
    // The cookie no longer signs in.
    expect((await request(app).get("/account").set("Cookie", ada)).status).toBe(401);

    // Grace and the Guest Run are untouched.
    expect(await prisma.user.count({ where: { id: graceId } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: graceId } })).toBe(1);
    expect(await prisma.authAccount.count({ where: { userId: graceId } })).toBe(1);
    expect((await store.get(graces))?.accountId).toBe(graceId);
    expect((await store.get(guest))?.accountId).toBeNull();
    await expectThread(graces, true);
    await expectThread(guest, true);
    expect((await request(app).get(`/runs/${graces}`).set("Cookie", grace)).status).toBe(200);
  });

  it("deletes an Account that has no Runs", async () => {
    const ada = await signUpAndIn(ADA);
    expect((await request(app).delete("/account").set("Cookie", ada)).status).toBe(204);
    expect(await prisma.user.count()).toBe(0);
  });
});
