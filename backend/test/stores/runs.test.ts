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
