import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunIdSchema, RunViewSchema } from "@resume-ai/shared";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPrisma } from "./db.js";
import { RunStore } from "./run-store.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures");
const fixture = (name: string) => readFileSync(join(fixtures, name));

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);
const app = createApp({ store, config });

const JD = "We are hiring a backend developer with Node.js and PostgreSQL experience.";

const upload = (file: string | null, jobDescription: string | null = JD) => {
  const req = request(app).post("/runs");
  if (file) req.attach("cv", fixture(file), file);
  if (jobDescription !== null) req.field("jobDescription", jobDescription);
  return req;
};

beforeEach(async () => {
  await prisma.run.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /runs", () => {
  it.each(["cv.pdf", "cv.docx"])("accepts %s, stores the Run and returns its ID", async (file) => {
    const res = await upload(file);
    expect(res.status).toBe(201);
    const id = RunIdSchema.parse(res.body.id);
    expect(res.headers.location).toBe(`/runs/${id}`);

    const row = await store.get(id);
    expect(row?.cvText).toContain("Jane Doe");
    expect(row?.jdText).toBe(JD);
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBeCloseTo(config.runTtlMs, -4);
  });

  it.each([
    ["not-a-cv.txt", 415, "UNSUPPORTED_FILE"],
    ["cv-six-pages.pdf", 422, "TOO_MANY_PAGES"],
    ["cv-scanned.pdf", 422, "SCANNED_PDF"],
    ["cv-corrupt.pdf", 422, "EXTRACTION_FAILED"],
    ["cv-oversized.pdf", 413, "FILE_TOO_LARGE"],
  ])("rejects %s without creating a Run", async (file, status, code) => {
    const res = await upload(file);
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
    expect(typeof res.body.message).toBe("string");
    expect(await prisma.run.count()).toBe(0);
  });

  it("rejects a request without a CV", async () => {
    const res = await upload(null);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("rejects a request without a job description", async () => {
    const res = await upload("cv.pdf", null);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
    expect(await prisma.run.count()).toBe(0);
  });

  it("strips NUL characters instead of failing on them", async () => {
    const res = await upload("cv.pdf", "Backend\u0000 developer");
    expect(res.status).toBe(201);
    expect((await store.get(RunIdSchema.parse(res.body.id)))?.jdText).toBe("Backend developer");
  });

  it("rejects a job description over the limit", async () => {
    const res = await upload("cv.pdf", "x".repeat(config.limits.maxJdChars + 1));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("JOB_DESCRIPTION_TOO_LONG");
    expect(await prisma.run.count()).toBe(0);
  });
});

describe("GET /runs/:id", () => {
  it("returns a valid RunView parked at extraction", async () => {
    const { body } = await upload("cv.pdf");
    const res = await request(app).get(`/runs/${body.id}`);
    expect(res.status).toBe(200);
    const view = RunViewSchema.parse(res.body);
    expect(view.status).toBe("extracting");
    expect(view.id).toBe(body.id);
    expect(view.steps.find((s) => s.key === "parse")?.state).toBe("done");
    expect(view.steps.find((s) => s.key === "extract")?.state).toBe("pending");
    expect(view.job).toBeNull();
  });

  it("returns 404 for an unknown ID", async () => {
    const res = await request(app).get("/runs/3f0c1d4e-5b2a-4c8e-9a71-0d6e2f8b7a11");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RUN_NOT_FOUND");
  });

  it("answers an unknown path with the JSON error shape", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RUN_NOT_FOUND");
  });

  it("returns the same 404 for a malformed ID", async () => {
    const res = await request(app).get("/runs/not-a-uuid");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RUN_NOT_FOUND");
  });

  it("returns 404 for an expired Run even while its row still exists", async () => {
    const { body } = await upload("cv.pdf");
    const later = createApp({ store, config, now: () => new Date(Date.now() + config.runTtlMs + 1000) });
    const res = await request(later).get(`/runs/${body.id}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RUN_NOT_FOUND");
    expect(await store.get(RunIdSchema.parse(body.id))).not.toBeNull();
  });
});
