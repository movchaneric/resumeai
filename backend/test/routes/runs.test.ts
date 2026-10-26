import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunIdSchema, RunViewSchema } from "@resume-ai/shared";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "@/app.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { RunStore } from "@/stores/runs.js";
import { ExtractionError } from "@/extraction/errors.js";
import { LlmSchemaError } from "@/llm/llmClient.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { FakeJobProfileCache } from "../fakes/jobProfileCache.js";
import { makeGraphRunner } from "../fakes/runGraph.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";

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
const jobProfileCache = new FakeJobProfileCache();
const graphRunner = makeGraphRunner(store, llm, llm, jobProfileCache);
const app = createApp({ store, config, graphRunner, runInBackground });

const JOB_DESCRIPTION = "We are hiring a backend developer with Node.js and PostgreSQL experience.";

const upload = (file: string | null, jobDescription: string | null = JOB_DESCRIPTION) => {
  const req = request(app).post("/runs");
  if (file) req.attach("cv", fixture(file), file);
  if (jobDescription !== null) req.field("jobDescription", jobDescription);
  return req;
};

beforeEach(async () => {
  await store.deleteAll();
  jobProfileCache.rows.clear();
  tasks = [];
  llm.calls.length = 0;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /runs", () => {
  it.each(["cv.pdf", "cv.docx"])("accepts %s, stores the Run and returns its ID", async (file) => {
    // An app whose background task never starts, so the Run stays as `POST` left it.
    const idle = createApp({ store, config, graphRunner, runInBackground: () => {} });
    const res = await request(idle).post("/runs").attach("cv", fixture(file), file).field("jobDescription", JOB_DESCRIPTION);
    expect(res.status).toBe(201);
    const id = RunIdSchema.parse(res.body.id);
    expect(res.headers.location).toBe(`/runs/${id}`);

    const row = await store.get(id);
    expect(row?.status).toBe("extracting");
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
    llm.enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", coverageAnswer);
    const res = await upload("cv.pdf", "Backend\u0000 developer");
    expect(res.status).toBe(201);
    await settle();
    expect(JSON.stringify(llm.calls[0]!.messages)).toContain("Backend developer");
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
    const idle = createApp({ store, config, graphRunner, runInBackground: () => {} });
    const created = await request(idle).post("/runs").attach("cv", fixture("cv.pdf"), "cv.pdf").field("jobDescription", JOB_DESCRIPTION);
    const res = await request(idle).get(`/runs/${created.body.id}`);
    expect(res.status).toBe(200);
    const view = RunViewSchema.parse(res.body);
    expect(view.status).toBe("extracting");
    expect(view.steps.find((s) => s.key === "parse")?.state).toBe("done");
    expect(view.steps.find((s) => s.key === "extract")?.state).toBe("running");
    expect(view.job).toBeNull();
  });

  it("shows the Run as awaiting_review, with its scores and requirements, once the pipeline has finished", async () => {
    llm.enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", coverageAnswer);
    const { body } = await upload("cv.pdf");
    await settle();

    const res = await request(app).get(`/runs/${body.id}`);
    expect(res.status).toBe(200);
    const view = RunViewSchema.parse(res.body);
    expect(view.id).toBe(body.id);
    expect(view.status).toBe("awaiting_review");
    if (view.status !== "awaiting_review") return;
    expect(view.score).toEqual({ before: 100, after: 100 });
    expect(view.job).toEqual({ title: "Backend Developer", company: "Initech" });
    expect(view.steps.map((s) => `${s.key}:${s.state}`)).toContain("review:running");
    expect(view.changes).toEqual([]);
    expect(view.userEvidence).toEqual([]);
    expect(view.iterations).toEqual({ used: 0, max: 3 });
    expect(view.exitReason).toBe("target_reached");
    expect(view.requirements).toEqual([
      {
        id: "req1",
        text: "Node.js",
        importance: "must_have",
        before: "met",
        after: { verdict: "met", evidenceIds: ["exp1.b1"], reason: "Built Node.js services." },
        confirmedGap: false,
      },
    ]);
    expect(view.cv.experience[0]?.id).toBe("exp1");
  });

  it("shows a failed Run with coverage failed when the Coverage answer stays invalid", async () => {
    llm
      .enqueue("extract_job_profile", extractedJob)
      .enqueue("extract_cv", extractedCv)
      .enqueueVoted("assess_coverage", new LlmSchemaError("bad", ["a: wrong"]), new LlmSchemaError("bad", ["b: wrong"]));
    const { body } = await upload("cv.pdf");
    await settle();

    const view = RunViewSchema.parse((await request(app).get(`/runs/${body.id}`)).body);
    expect(view.status).toBe("failed");
    if (view.status === "failed") expect(view.error.code).toBe("COVERAGE_FAILED");
    expect(view.job).toEqual({ title: "Backend Developer", company: "Initech" });
    expect(view.steps.filter((s) => s.state !== "pending").map((s) => `${s.key}:${s.state}`)).toEqual([
      "parse:done",
      "extract:done",
      "coverage:failed",
    ]);
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
    const later = createApp({ store, config, graphRunner, now: () => new Date(Date.now() + config.runTtlMs + 1000) });
    const res = await request(later).get(`/runs/${body.id}`);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("RUN_NOT_FOUND");
    expect(await store.get(RunIdSchema.parse(body.id))).not.toBeNull();
  });
});

describe("POST /runs/:id/answers", () => {
  const job = {
    ...extractedJob,
    requirements: [
      { text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" },
      { text: "PostgreSQL", source: "PostgreSQL", kind: "skill", importance: "must_have" },
      { text: "Kubernetes", source: "Kubernetes", kind: "skill", importance: "must_have" },
    ],
  };
  const coverage = {
    verdicts: ["met", "unmet", "unmet"].map((verdict, i) => ({
      requirementId: `req${i + 1}`,
      reason: "r",
      evidenceIds: verdict === "met" ? ["exp1.b1"] : [],
      verdict,
    })),
  };
  const has = (questionId: string, text: string) => ({ kind: "has_experience", questionId, text });

  /** Uploads a CV and runs the pipeline until it pauses for Answers (Questions q1, q2). */
  async function awaitingAnswers(): Promise<string> {
    llm.enqueue("extract_job_profile", job).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", coverage);
    const { body } = await upload("cv.pdf");
    await settle();
    expect((await request(app).get(`/runs/${body.id}`)).body.status).toBe("awaiting_answers");
    return body.id;
  }
  const post = (id: string, body: unknown) => request(app).post(`/runs/${id}/answers`).send(body as object);

  it("answers 202 with the Run ID and resumes the graph with trimmed Answers", async () => {
    const id = await awaitingAnswers();
    llm.enqueue("tailor", { changes: [] }, { changes: [] });
    const res = await post(id, { answers: [has("q2", "  Ran a small cluster.  "), { kind: "no_experience", questionId: "q1" }] });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id });
    await settle();
    const view = RunViewSchema.parse((await request(app).get(`/runs/${id}`)).body);
    expect(view.status).toBe("awaiting_review");
    if (view.status !== "awaiting_review") return;
    expect(view.userEvidence.map((u) => u.text)).toEqual(["Ran a small cluster."]);
    expect(view.requirements.find((r) => r.id === "req2")?.confirmedGap).toBe(true);
  });

  it("treats an empty list as skipping every Question", async () => {
    const id = await awaitingAnswers();
    const res = await post(id, { answers: [] });
    expect(res.status).toBe(202);
    await settle();
    expect(RunViewSchema.parse((await request(app).get(`/runs/${id}`)).body).status).not.toBe("awaiting_answers");
  });

  it("answers 409 to a second submission and resumes only once", async () => {
    const id = await awaitingAnswers();
    // The background task is held back, so the second request arrives while the resume is in flight.
    const held: (() => Promise<void>)[] = [];
    const slow = createApp({ store, config, graphRunner, runInBackground: (t) => void held.push(t) });
    const send = () => request(slow).post(`/runs/${id}/answers`).send({ answers: [] });
    const [first, second] = [await send(), await send()];
    expect([first.status, second.status]).toEqual([202, 409]);
    expect(second.body.code).toBe("RUN_NOT_AWAITING_ANSWERS");
    expect(held).toHaveLength(1);
  });

  it.each([
    ["answers missing", {}],
    ["answers not a list", { answers: "q1" }],
    ["an invalid Answer", { answers: [{ kind: "maybe", questionId: "q1" }] }],
    ["blank text", { answers: [has("q1", "   ")] }],
    ["text over 1,000 characters", { answers: [has("q1", "x".repeat(1001))] }],
    ["an unknown Question", { answers: [has("q9", "text")] }],
    ["a Question answered twice", { answers: [has("q1", "a"), has("q1", "b")] }],
  ])("answers 400 INVALID_ANSWERS for %s and leaves the Run waiting", async (_name, body) => {
    const id = await awaitingAnswers();
    const res = await post(id, body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_ANSWERS");
    expect((await request(app).get(`/runs/${id}`)).body.status).toBe("awaiting_answers");
  });

  it("answers 400 to a body that is not JSON", async () => {
    const id = await awaitingAnswers();
    const res = await request(app).post(`/runs/${id}/answers`).set("Content-Type", "application/json").send("{nope");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("answers 404 for an unknown or malformed Run ID", async () => {
    for (const id of ["3f0c1d4e-5b2a-4c8e-9a71-0d6e2f8b7a11", "nope"]) {
      const res = await post(id, { answers: [] });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("RUN_NOT_FOUND");
    }
  });

  it("answers 409 when the Run is not waiting for Answers", async () => {
    llm.enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", coverageAnswer);
    const { body } = await upload("cv.pdf");
    await settle();
    const res = await post(body.id, { answers: [] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RUN_NOT_AWAITING_ANSWERS");
  });
});
