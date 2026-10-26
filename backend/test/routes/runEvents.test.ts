import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RunIdSchema, RunViewSchema, type RunId, type RunView } from "@resume-ai/shared";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import type { z } from "zod";
import { createApp } from "@/app.js";
import { ExtractionError } from "@/extraction/errors.js";
import type { LlmMessage } from "@/llm/llmClient.js";
import { RunsService, type GraphRunner } from "@/services/runs.js";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { FakeJobProfileCache } from "../fakes/jobProfileCache.js";
import { makeGraphRunner } from "../fakes/runGraph.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";

const cvFile = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));
const JOB_DESCRIPTION = "We are hiring a backend developer with Node.js and PostgreSQL experience.";

/** A fake model whose calls to a named step wait until the test releases them, so a Run can be held mid-flight. */
class GatedLlm extends FakeLlmClient {
  private readonly gates = new Map<string, Promise<void>>();

  hold(name: string): () => void {
    let release!: () => void;
    this.gates.set(name, new Promise<void>((resolve) => (release = resolve)));
    return release;
  }

  reset(): void {
    this.gates.clear();
    this.calls.length = 0;
  }

  override async structured<T>(schema: z.ZodType<T>, messages: LlmMessage[], options: { name: string }): Promise<T> {
    await this.gates.get(options.name);
    return super.structured(schema, messages, options);
  }
}

/** The bus, plus a count of the subscriptions still open. */
class CountingEvents extends InProcessRunEvents {
  active = 0;

  override subscribe(runId: RunId, listener: () => void): () => void {
    this.active++;
    const unsubscribe = super.subscribe(runId, listener);
    let ended = false;
    return () => {
      if (!ended) this.active--;
      ended = true;
      unsubscribe();
    };
  }
}

type Client = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  views: RunView[];
  comments: string[];
  ended: boolean;
  destroy: () => void;
};

const servers: http.Server[] = [];
const clients: Client[] = [];

function listen(app: Express): http.Server {
  const server = app.listen(0);
  servers.push(server);
  return server;
}

/** Opens `GET <path>` and parses Server-Sent Events frames as they arrive. Resolves when the response headers do. */
function openStream(server: http.Server, path: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const req = http.get({ port: (server.address() as AddressInfo).port, path }, (res) => {
      const client: Client = { status: res.statusCode!, headers: res.headers, body: "", views: [], comments: [], ended: false, destroy: () => req.destroy() };
      clients.push(client);
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        client.body += chunk;
        buffer += chunk;
        for (let end = buffer.indexOf("\n\n"); end !== -1; end = buffer.indexOf("\n\n")) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (frame.startsWith(":")) client.comments.push(frame);
          else {
            expect(frame).toMatch(/^event: run\ndata: /);
            client.views.push(RunViewSchema.parse(JSON.parse(frame.slice("event: run\ndata: ".length))));
          }
        }
      });
      res.on("end", () => (client.ended = true));
      res.on("close", () => (client.ended = true));
      resolve(client);
    });
    req.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code !== "ECONNRESET") reject(error);
    });
  });
}

async function until(condition: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);
const llm = new GatedLlm();
const events = new CountingEvents();
const jobProfileCache = new FakeJobProfileCache();
const graphRunner = makeGraphRunner(store, llm, llm, jobProfileCache, events);
let tasks: Promise<void>[] = [];
const runInBackground = (task: () => Promise<void>) => {
  tasks.push(task());
};
const settle = async () => {
  await Promise.all(tasks);
  tasks = [];
};
const app = createApp({ store, config, graphRunner, events, runInBackground });
const server = listen(app);

const upload = async (target: Express | http.Server = server): Promise<RunId> => {
  const res = await request(target).post("/runs").attach("cv", cvFile, "cv.pdf").field("jobDescription", JOB_DESCRIPTION);
  expect(res.status).toBe(201);
  return RunIdSchema.parse(res.body.id);
};

/** A Job Description with three Requirements, two of them unmet, so the Run pauses for Answers (Questions q1, q2). */
const questionsJob = {
  ...extractedJob,
  requirements: ["Node.js", "PostgreSQL", "Kubernetes"].map((text) => ({ text, source: text, kind: "skill", importance: "must_have" })),
};
const questionsCoverage = {
  verdicts: ["met", "unmet", "unmet"].map((verdict, i) => ({
    requirementId: `req${i + 1}`,
    reason: "r",
    evidenceIds: verdict === "met" ? ["exp1.b1"] : [],
    verdict,
  })),
};
const enqueueToQuestions = () => llm.enqueue("extract_job_profile", questionsJob).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", questionsCoverage);
const enqueueToReview = () => llm.enqueue("extract_job_profile", extractedJob).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", coverageAnswer);

const order = (status: string) => ["extracting", "tailoring", "awaiting_review"].indexOf(status);
const stepState = (view: RunView, key: string) => view.steps.find((s) => s.key === key)?.state;

beforeEach(async () => {
  await store.deleteAll();
  jobProfileCache.rows.clear();
  llm.reset();
  tasks = [];
});
afterEach(async () => {
  for (const client of clients.splice(0)) client.destroy();
  await settle();
});
afterAll(async () => {
  for (const s of servers) s.close();
  await prisma.$disconnect();
});

describe("GET /runs/:id/events", () => {
  it("opens an event stream with no caching and no proxy buffering, and sends the current view first", async () => {
    const release = llm.hold("extract_job_profile");
    const id = await upload();
    const client = await openStream(server, `/runs/${id}/events`);
    expect(client.status).toBe(200);
    expect(client.headers["content-type"]).toContain("text/event-stream");
    expect(client.headers["cache-control"]).toBe("no-cache");
    expect(client.headers["x-accel-buffering"]).toBe("no");

    await until(() => client.views.length === 1, "the first view");
    const current = (await request(server).get(`/runs/${id}`)).body;
    expect(client.views[0]).toEqual(current);
    expect(client.views[0]!.status).toBe("extracting");
    expect(stepState(client.views[0]!, "extract")).toBe("running");
    expect(client.ended).toBe(false);
    release();
  });

  it("pushes the Run through extraction and Coverage to the Questions, then closes", async () => {
    enqueueToQuestions();
    const release = llm.hold("extract_job_profile");
    const releaseCoverage = llm.hold("assess_coverage");
    const id = await upload();
    const client = await openStream(server, `/runs/${id}/events`);
    await until(() => client.views.length === 1, "the first view");
    release();
    // Coverage is held, so the view with extraction done is observable rather than coalesced into the final one.
    await until(() => client.views.some((v) => stepState(v, "coverage") === "running"), "Coverage to start");
    releaseCoverage();
    await until(() => client.ended, "the stream to close");

    const last = client.views.at(-1)!;
    expect(last.status).toBe("awaiting_answers");
    if (last.status === "awaiting_answers") expect(last.questions.map((q) => q.id)).toEqual(["q1", "q2"]);
    const seen = client.views.map((v) => `${v.status}:${stepState(v, "extract")}/${stepState(v, "coverage")}/${stepState(v, "questions")}`);
    expect(seen).toContain("extracting:running/pending/pending");
    expect(seen).toContain("extracting:done/running/pending");
    expect(seen.at(-1)).toBe("awaiting_answers:done/done/running");
    expect(client.views.slice(0, -1).every((v) => v.status === "extracting")).toBe(true);
  });

  it("follows the Run after its Answers through each tailoring round to review, on a new stream", async () => {
    enqueueToQuestions();
    const id = await upload();
    await settle();
    expect((await request(server).get(`/runs/${id}`)).body.status).toBe("awaiting_answers");

    llm.enqueue("tailor", { changes: [] }, { changes: [] });
    const release = llm.hold("tailor");
    const post = await request(server).post(`/runs/${id}/answers`).send({ answers: [] });
    expect(post.status).toBe(202);
    const client = await openStream(server, `/runs/${id}/events`);
    await until(() => client.views.length >= 1, "the first view");
    expect(client.views[0]!.status).toBe("tailoring");
    release();
    await until(() => client.ended, "the stream to close");

    const last = client.views.at(-1)!;
    expect(last.status).toBe("awaiting_review");
    const used = client.views.flatMap((v) => (v.status === "tailoring" || v.status === "awaiting_review" ? [v.iterations.used] : []));
    expect(used).toEqual([...used].sort((a, b) => a - b));
    expect(used.at(-1)).toBe(2);
    expect(client.views.some((v) => v.status === "tailoring" && v.iterations.used === 2)).toBe(true);
    expect(client.views.filter((v) => v.status === "tailoring").every((v) => stepState(v, "tailor") === "running")).toBe(true);
  });

  it("closes after awaiting_review when the Run needs no Questions", async () => {
    enqueueToReview();
    const release = llm.hold("extract_job_profile");
    const id = await upload();
    const client = await openStream(server, `/runs/${id}/events`);
    release();
    await until(() => client.ended, "the stream to close");
    expect(client.views.at(-1)!.status).toBe("awaiting_review");
    expect(client.views.filter((v) => v.status === "awaiting_review")).toHaveLength(1);
  });

  it("pushes a failure with the same error GET /runs/:id gives, then closes", async () => {
    llm.enqueue("extract_job_profile", new ExtractionError("bad output", ["issue"]));
    const release = llm.hold("extract_job_profile");
    const id = await upload();
    const client = await openStream(server, `/runs/${id}/events`);
    release();
    await until(() => client.ended, "the stream to close");
    const last = client.views.at(-1)!;
    expect(last.status).toBe("failed");
    expect(last).toEqual((await request(server).get(`/runs/${id}`)).body);
    if (last.status === "failed") expect(last.error.code).toBe("EXTRACTION_FAILED");
  });

  it("sends the view and closes at once for a Run that already needs the user", async () => {
    enqueueToQuestions();
    const id = await upload();
    await settle();
    const client = await openStream(server, `/runs/${id}/events`);
    await until(() => client.ended, "the stream to close");
    expect(client.views.map((v) => v.status)).toEqual(["awaiting_answers"]);
  });

  it.each(["interrupted", "completed"] as const)("closes right after a view with status %s", async (status) => {
    enqueueToReview();
    const id = await upload();
    await settle();
    // The view builder does not produce these statuses yet, so the service is given one built from a Run in review.
    const real = RunViewSchema.parse((await request(server).get(`/runs/${id}`)).body);
    const resting = RunViewSchema.parse(
      status === "completed"
        ? { ...real, status, download: { docx: null, pdf: null } }
        : { id: real.id, createdAt: real.createdAt, expiresAt: real.expiresAt, job: real.job, steps: real.steps, status },
    );
    const spy = vi.spyOn(RunsService.prototype, "getRunView").mockResolvedValue(resting);
    try {
      const client = await openStream(server, `/runs/${id}/events`);
      await until(() => client.ended, "the stream to close");
      expect(client.views.map((v) => v.status)).toEqual([status]);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not send a view identical to the last one", async () => {
    const release = llm.hold("extract_job_profile");
    enqueueToReview();
    const id = await upload();
    const client = await openStream(server, `/runs/${id}/events`);
    await until(() => client.views.length === 1, "the first view");
    for (let i = 0; i < 5; i++) events.publish(id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.views).toHaveLength(1);

    release();
    await until(() => client.ended, "the stream to close");
    const json = client.views.map((v) => JSON.stringify(v));
    json.forEach((view, i) => expect(view).not.toBe(json[i - 1]));
  });

  it("does not lose a change that lands between subscribing and reading the snapshot", async () => {
    enqueueToQuestions();
    const releaseExtraction = llm.hold("extract_job_profile");
    // The first snapshot read returns the state it saw, but only after the test lets it go.
    let gate: { reached: () => void; wait: Promise<void> } | null = null;
    const slowRead: GraphRunner = {
      start: (input) => graphRunner.start(input),
      answer: (runId, answers) => graphRunner.answer(runId, answers),
      async read(runId) {
        const snapshot = await graphRunner.read(runId);
        const mine = gate;
        gate = null;
        if (mine) {
          mine.reached();
          await mine.wait;
        }
        return snapshot;
      },
    };
    const slowApp = createApp({ store, config, graphRunner: slowRead, events, runInBackground });
    const slowServer = listen(slowApp);
    const id = await upload(slowServer);

    let releaseRead!: () => void;
    let reached!: () => void;
    const hasReached = new Promise<void>((resolve) => (reached = resolve));
    gate = { reached, wait: new Promise<void>((resolve) => (releaseRead = resolve)) };
    const opening = openStream(slowServer, `/runs/${id}/events`);
    await hasReached;
    // The Run moves on while the snapshot is still being read.
    releaseExtraction();
    await settle();
    expect((await store.get(id))?.status).toBe("awaiting_answers");
    releaseRead();

    const client = await opening;
    await until(() => client.ended, "the stream to close");
    expect(client.views.at(-1)!.status).toBe("awaiting_answers");
  });

  it("sends views in order when a change is published while the first view is being built", async () => {
    const release = llm.hold("extract_job_profile");
    enqueueToReview();
    const id = await upload();
    // Hold the first view build; its result is the older state.
    const original = RunsService.prototype.getRunView;
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => (releaseFirst = resolve));
    let calls = 0;
    const spy = vi.spyOn(RunsService.prototype, "getRunView").mockImplementation(async function (this: RunsService, rawId: string) {
      const view = await original.call(this, rawId);
      if (++calls === 1) await firstHeld;
      return view;
    });
    try {
      const opening = openStream(server, `/runs/${id}/events`);
      await until(() => calls === 1, "the first build to start");
      // The Run moves on and a push arrives while the first build is held.
      release();
      await settle();
      events.publish(id);
      await until(() => calls >= 1, "the push");
      await new Promise((resolve) => setTimeout(resolve, 50));
      releaseFirst();
      const client = await opening;
      await until(() => client.ended, "the stream to close");
      expect(client.views[0]!.status).toBe("extracting");
      expect(client.views.at(-1)!.status).toBe("awaiting_review");
      expect(client.views.map((v) => v.status)).toEqual(client.views.map((v) => v.status).sort((a, b) => order(a) - order(b)));
    } finally {
      spy.mockRestore();
    }
  });

  it("gives every client on the Run every update", async () => {
    enqueueToQuestions();
    const release = llm.hold("extract_job_profile");
    const id = await upload();
    const [a, b] = [await openStream(server, `/runs/${id}/events`), await openStream(server, `/runs/${id}/events`)];
    await until(() => a.views.length === 1 && b.views.length === 1, "both first views");
    release();
    await until(() => a.ended && b.ended, "both streams to close");
    expect(a.views.length).toBeGreaterThan(1);
    expect(b.views).toEqual(a.views);
    expect(a.views.at(-1)!.status).toBe("awaiting_answers");
  });

  it("sends a comment every heartbeat interval while the Run is quiet", async () => {
    const beating = listen(createApp({ store, config: { ...config, sseHeartbeatMs: 30 }, graphRunner, events, runInBackground }));
    const release = llm.hold("extract_job_profile");
    enqueueToReview();
    const id = await upload(beating);
    const client = await openStream(beating, `/runs/${id}/events`);
    await until(() => client.comments.length >= 3, "three heartbeats");
    expect(client.comments.every((c) => c.startsWith(":"))).toBe(true);
    expect(client.views).toHaveLength(1);

    release();
    await until(() => client.ended, "the stream to close");
    const after = client.comments.length;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.comments.length).toBe(after);
  });

  it("releases the subscription when the client disconnects, and when the stream closes itself", async () => {
    const release = llm.hold("extract_job_profile");
    enqueueToQuestions();
    const id = await upload();
    const before = events.active;
    const client = await openStream(server, `/runs/${id}/events`);
    await until(() => client.views.length === 1, "the first view");
    expect(events.active).toBe(before + 1);
    client.destroy();
    await until(() => events.active === before, "the subscription to be released");

    const other = await openStream(server, `/runs/${id}/events`);
    await until(() => other.views.length === 1, "the first view");
    release();
    await until(() => other.ended, "the stream to close");
    await until(() => events.active === before, "the subscription to be released");
  });

  it("ignores Last-Event-ID and sends no event ids", async () => {
    enqueueToQuestions();
    const id = await upload();
    await settle();
    const res = await request(server).get(`/runs/${id}/events`).set("Last-Event-ID", "7").buffer(true).parse((r, cb) => {
      let text = "";
      r.setEncoding("utf8");
      r.on("data", (c: string) => (text += c));
      r.on("end", () => cb(null, text));
    });
    expect(String(res.body)).not.toMatch(/^id:/m);
    expect(String(res.body).match(/^event: run$/gm)).toHaveLength(1);
  });

  it("answers 404 JSON, with no stream, for an unknown, malformed or expired Run", async () => {
    const id = await upload();
    await settle();
    const later = listen(createApp({ store, config, graphRunner, events, now: () => new Date(Date.now() + config.runTtlMs + 1000) }));
    const cases: [http.Server, string][] = [
      [server, "/runs/3f0c1d4e-5b2a-4c8e-9a71-0d6e2f8b7a11/events"],
      [server, "/runs/not-a-uuid/events"],
      [later, `/runs/${id}/events`],
    ];
    for (const [target, path] of cases) {
      const client = await openStream(target, path);
      await until(() => client.ended, "the response to end");
      expect(client.status).toBe(404);
      expect(client.headers["content-type"]).toContain("application/json");
      expect(JSON.parse(client.body).code).toBe("RUN_NOT_FOUND");
    }
  });
});
