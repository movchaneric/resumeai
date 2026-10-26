import { JobProfileSchema, type JobProfile } from "@resume-ai/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { JobProfileStore } from "@/stores/jobProfiles.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const DAY = 24 * 60 * 60 * 1000;

let clock = new Date("2026-01-01T00:00:00Z");
const store = new JobProfileStore(prisma, { ttlMs: 7 * DAY, now: () => clock });

const profile = (title: string): JobProfile =>
  JobProfileSchema.parse({
    title,
    company: "Initech",
    requirements: [{ id: "req1", text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" }],
  });

beforeEach(async () => {
  clock = new Date("2026-01-01T00:00:00Z");
  await prisma.jobProfile.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("JobProfileStore", () => {
  it("returns null for an unknown key", async () => {
    expect(await store.get("nope")).toBeNull();
  });

  it("returns a profile it was given", async () => {
    await store.put("k1", profile("Backend Developer"));
    expect(await store.get("k1")).toEqual(profile("Backend Developer"));
  });

  it("expires a profile 7 days after it was put", async () => {
    await store.put("k1", profile("Backend Developer"));
    clock = new Date(clock.getTime() + 7 * DAY - 1);
    expect(await store.get("k1")).not.toBeNull();
    clock = new Date(clock.getTime() + 1);
    expect(await store.get("k1")).toBeNull();
  });

  it("keeps the first profile when the same key is put twice", async () => {
    await store.put("k1", profile("First"));
    await store.put("k1", profile("Second"));
    expect((await store.get("k1"))?.title).toBe("First");
  });

  it("treats a row that is not a valid Job Profile as a miss", async () => {
    await prisma.jobProfile.create({ data: { key: "bad", profile: { title: 42 }, expiresAt: new Date(clock.getTime() + DAY) } });
    expect(await store.get("bad")).toBeNull();
  });
});
