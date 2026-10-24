import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunIdSchema, RunViewSchema, type ExtractedCv, type ItemId, type RequirementId } from "@resume-ai/shared";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { RunStore } from "@/stores/runs.js";
import { ExtractionError } from "@/extraction/errors.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const fixture = (name: string) => readFileSync(join(fixtures, name));

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);
const llm = new FakeLlmClient();
// Extraction runs detached from the request; the tests collect it here and await it.
let tasks: Promise<void>[] = [];
const runInBackground = (task: () => Promise<void>) => {
  tasks.push(task());
};
const settle = async () => {
  await Promise.all(tasks);
  tasks = [];
};
const app = createApp({ store, config, llm, runInBackground });

const range = (start: string, end: string | null) => ({ start, end, current: end === null });
/** What a model would extract from the text of `fixtures/cv.pdf`; every protected field is quoted from it. */
const extractedCv: ExtractedCv = {
  contact: { name: "Jane Doe", email: "jane.doe@example.com", phone: null, location: "Springfield", links: [] },
  summary: null,
  experience: [
    {
      company: "Acme Corp",
      title: "Senior Backend Developer",
      location: null,
      dates: range("2021", null),
      bullets: ["Designed and maintained Node.js services backed by PostgreSQL."],
    },
  ],
  education: [
    { institution: "Springfield University", degree: "BSc", field: "Computer Science", dates: range("2014", "2018"), bullets: [] },
  ],
  skills: ["TypeScript", "Node.js"],
  projects: [],
  certifications: [],
  additionalSections: [],
};
const extractedJob = {
  title: "Backend Developer",
  company: "Initech",
  requirements: [{ text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" }],
};

const JOB_DESCRIPTION = "We are hiring a backend developer with Node.js and PostgreSQL experience.";

const upload = (file: string | null, jobDescription: string | null = JOB_DESCRIPTION) => {
  const req = request(app).post("/runs");
  if (file) req.attach("cv", fixture(file), file);
  if (jobDescription !== null) req.field("jobDescription", jobDescription);
  return req;
};

beforeEach(async () => {
  await store.deleteAll();
  tasks = [];
  llm.calls.length = 0;
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
    expect(row?.jobDescriptionText).toBe(JOB_DESCRIPTION);
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(config.runTtlMs);
  });

  it.each([
    ["not-a-cv.txt", 415, "UNSUPPORTED_FILE"],
    ["cv-six-pages.pdf", 422, "TOO_MANY_PAGES"],
    ["cv-scanned.pdf", 422, "SCANNED_PDF"],
    ["cv-corrupt.pdf", 422, "UNREADABLE_FILE"],
    ["cv-oversized.pdf", 413, "FILE_TOO_LARGE"],
  ])("rejects %s without creating a Run", async (file, status, code) => {
    const res = await upload(file);
    expect(res.status).toBe(status);
    expect(res.body.code).toBe(code);
    expect(typeof res.body.message).toBe("string");
    expect(await store.count()).toBe(0);
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
    expect(await store.count()).toBe(0);
  });

  it("strips NUL characters instead of failing on them", async () => {
    const res = await upload("cv.pdf", "Backend\u0000 developer");
    expect(res.status).toBe(201);
    expect((await store.get(RunIdSchema.parse(res.body.id)))?.jobDescriptionText).toBe("Backend developer");
  });

  it("rejects a job description over the limit", async () => {
    const res = await upload("cv.pdf", "x".repeat(config.limits.maxJobDescriptionChars + 1));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("JOB_DESCRIPTION_TOO_LONG");
    expect(await store.count()).toBe(0);
  });
});

describe("GET /runs/:id", () => {
  it("returns a valid RunView while extraction is running", async () => {
    // An app whose background task never starts, so the Run stays as `POST` left it.
    const idle = createApp({ store, config, llm, runInBackground: () => {} });
    const created = await request(idle).post("/runs").attach("cv", fixture("cv.pdf"), "cv.pdf").field("jobDescription", JOB_DESCRIPTION);
    const res = await request(idle).get(`/runs/${created.body.id}`);
    expect(res.status).toBe(200);
    const view = RunViewSchema.parse(res.body);
    expect(view.status).toBe("extracting");
    expect(view.steps.find((s) => s.key === "parse")?.state).toBe("done");
    expect(view.steps.find((s) => s.key === "extract")?.state).toBe("running");
    expect(view.job).toBeNull();
  });

  it("shows the extracted state once the background task has finished", async () => {
    llm.enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv);
    const { body } = await upload("cv.pdf");
    await settle();

    const res = await request(app).get(`/runs/${body.id}`);
    expect(res.status).toBe(200);
    const view = RunViewSchema.parse(res.body);
    expect(view.status).toBe("extracting");
    expect(view.id).toBe(body.id);
    expect(view.steps.find((s) => s.key === "parse")?.state).toBe("done");
    expect(view.steps.find((s) => s.key === "extract")?.state).toBe("done");
    expect(view.job).toEqual({ title: "Backend Developer", company: "Initech" });
    const row = await store.get(RunIdSchema.parse(body.id));
    expect(row?.cv?.experience[0]?.id).toBe("exp1");
    expect(row?.jobProfile?.requirements[0]?.id).toBe("req1");
  });

  it("shows a failed Run with the error code when extraction fails", async () => {
    llm.enqueue("extract_job_profile", new ExtractionError("bad output", ["issue"]));
    const { body } = await upload("cv.pdf");
    await settle();

    const res = await request(app).get(`/runs/${body.id}`);
    const view = RunViewSchema.parse(res.body);
    expect(view.status).toBe("failed");
    if (view.status === "failed") expect(view.error.code).toBe("EXTRACTION_FAILED");
    expect(view.job).toBeNull();
    expect(view.steps.find((s) => s.key === "extract")?.state).toBe("failed");
  });

  it("shows a Run with coverage saved through the store as scored", async () => {
    llm.enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv);
    const { body } = await upload("cv.pdf");
    await settle();
    const id = RunIdSchema.parse(body.id);
    await store.saveCoverage(id, [
      { requirementId: "req1" as RequirementId, verdict: "partially_met", evidenceIds: ["skill2" as ItemId], reason: "Listed only." },
    ]);

    const view = RunViewSchema.parse((await request(app).get(`/runs/${id}`)).body);
    expect(view.status).toBe("scored");
    if (view.status !== "scored") return;
    expect(view.score).toBe(50);
    expect(view.steps.find((s) => s.key === "coverage")?.state).toBe("done");
    expect(view.requirements).toEqual([
      { id: "req1", text: "Node.js", importance: "must_have", verdict: "partially_met", evidenceIds: ["skill2"], reason: "Listed only." },
    ]);
  });

  it("shows a failed Run with extraction stored as coverage failed", async () => {
    llm.enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv);
    const { body } = await upload("cv.pdf");
    await settle();
    const id = RunIdSchema.parse(body.id);
    await store.markFailed(id, "COVERAGE_FAILED", "We couldn't assess your CV against this job. Try again.");

    const view = RunViewSchema.parse((await request(app).get(`/runs/${id}`)).body);
    expect(view.status).toBe("failed");
    if (view.status === "failed") expect(view.error.code).toBe("COVERAGE_FAILED");
    expect(view.job).toEqual({ title: "Backend Developer", company: "Initech" });
    expect(view.steps.filter((s) => s.state !== "pending").map((s) => `${s.key}:${s.state}`)).toEqual([
      "parse:done",
      "extract:done",
      "coverage:failed",
    ]);
  });

  it("returns 404 for an unknown ID", async () => {
    const res = await request(app).get("/runs/3f0c1d4e-5b2a-4c8e-9a71-0d6e2f8b7a11");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RUN_NOT_FOUND");
  });

  it("answers an unknown path with the JSON error shape and a code that is not about Runs", async () => {
    const res = await request(app).get("/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
  });

  it("returns the same 404 for a malformed ID", async () => {
    const res = await request(app).get("/runs/not-a-uuid");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RUN_NOT_FOUND");
  });

  it("returns 404 for an expired Run even while its row still exists", async () => {
    const { body } = await upload("cv.pdf");
    const later = createApp({ store, config, llm, now: () => new Date(Date.now() + config.runTtlMs + 1000) });
    const res = await request(later).get(`/runs/${body.id}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RUN_NOT_FOUND");
    expect(await store.get(RunIdSchema.parse(body.id))).not.toBeNull();
  });
});
