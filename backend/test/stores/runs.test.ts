import { RunIdSchema, type RunStatus } from "@resume-ai/shared";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);

async function createRun(status: RunStatus) {
  const id = RunIdSchema.parse(randomUUID());
  const createdAt = new Date();
  await store.create({ id, status, createdAt, expiresAt: new Date(createdAt.getTime() + 60_000) });
  return id;
}

beforeEach(async () => {
  await store.deleteAll();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("RunStore.claimStatus", () => {
  it("moves the Run and returns true when it is in the expected status", async () => {
    const id = await createRun("awaiting_answers");
    expect(await store.claimStatus(id, "awaiting_answers", "tailoring")).toBe(true);
    expect((await store.get(id))?.status).toBe("tailoring");
  });

  it("returns false and leaves the Run alone when it is in another status", async () => {
    const id = await createRun("awaiting_review");
    expect(await store.claimStatus(id, "awaiting_answers", "tailoring")).toBe(false);
    expect((await store.get(id))?.status).toBe("awaiting_review");
  });

  it("returns false for an unknown Run", async () => {
    expect(await store.claimStatus(RunIdSchema.parse(randomUUID()), "awaiting_answers", "tailoring")).toBe(false);
  });

  it("lets exactly one of two simultaneous claims win", async () => {
    const id = await createRun("awaiting_answers");
    const results = await Promise.all([
      store.claimStatus(id, "awaiting_answers", "tailoring"),
      store.claimStatus(id, "awaiting_answers", "tailoring"),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("RunStore.listLive", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  async function createAt(status: RunStatus, createdAt: Date, expiresAt: Date) {
    const id = RunIdSchema.parse(randomUUID());
    await store.create({ id, status, createdAt, expiresAt });
    return id;
  }
  const later = new Date(now.getTime() + 60_000);

  it("lists the Runs in the given statuses, oldest first", async () => {
    const newer = await createAt("tailoring", new Date(now.getTime() - 1000), later);
    const older = await createAt("extracting", new Date(now.getTime() - 5000), later);
    await createAt("awaiting_answers", now, later);
    await createAt("failed", now, later);
    const runs = await store.listLive(["extracting", "tailoring"], now);
    expect(runs.map((run) => run.id)).toEqual([older, newer]);
  });

  it("skips Runs that expired at or before the given time", async () => {
    await createAt("extracting", now, now);
    await createAt("extracting", now, new Date(now.getTime() - 1));
    const live = await createAt("extracting", now, new Date(now.getTime() + 1));
    expect((await store.listLive(["extracting"], now)).map((run) => run.id)).toEqual([live]);
  });

  it("returns nothing for no statuses", async () => {
    await createAt("extracting", now, later);
    expect(await store.listLive([], now)).toEqual([]);
  });
});

describe("RunStore.claimRecovery", () => {
  it("counts the first recovery of a Run in the expected status", async () => {
    const id = await createRun("extracting");
    expect(await store.claimRecovery(id, "extracting")).toBe(true);
  });

  it("refuses a second recovery", async () => {
    const id = await createRun("tailoring");
    expect(await store.claimRecovery(id, "tailoring")).toBe(true);
    expect(await store.claimRecovery(id, "tailoring")).toBe(false);
  });

  it("refuses, and counts nothing, when the Run is in another status", async () => {
    const id = await createRun("awaiting_answers");
    expect(await store.claimRecovery(id, "extracting")).toBe(false);
    expect(await store.claimRecovery(id, "awaiting_answers")).toBe(true);
  });

  it("returns false for an unknown Run", async () => {
    expect(await store.claimRecovery(RunIdSchema.parse(randomUUID()), "extracting")).toBe(false);
  });

  it("lets exactly one of two simultaneous claims win", async () => {
    const id = await createRun("extracting");
    const results = await Promise.all([store.claimRecovery(id, "extracting"), store.claimRecovery(id, "extracting")]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("does not allow a negative count", async () => {
    const id = await createRun("extracting");
    await expect(prisma.$executeRaw`UPDATE app.runs SET recoveries = -1 WHERE id = ${id}::uuid`).rejects.toThrow();
  });
});
