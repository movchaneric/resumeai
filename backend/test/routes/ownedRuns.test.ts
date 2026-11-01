import { MyRunsSchema, RunIdSchema, RunSummarySchema, type RunId } from "@resume-ai/shared";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { acceptAll, enqueueToReview } from "../fakes/reviewRun.js";
import { makeAuthApp } from "../fakes/authApp.js";

// Real Better Auth and the real test database: an Owned Run is served only to its Account, signed in.

const { app, prisma, store, llm, settle, clearAuthTables, signUpAndIn, startRun, emails } = makeAuthApp();
const cvFile = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));

const ADA = { name: "Ada Example", email: "ada@example.com", password: "correct-horse-9" };
const GRACE = { name: "Grace Example", email: "grace@example.com", password: "battery-staple-9" };
const NOT_FOUND = { code: "RUN_NOT_FOUND", message: "Run not found." };

let ada: string;
let grace: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  llm.reset();
  await store.deleteAll();
  await clearAuthTables();
  emails.clear();
  ada = await signUpAndIn(ADA);
  grace = await signUpAndIn(GRACE);
});
afterAll(async () => {
  await store.deleteAll();
  await clearAuthTables();
  await prisma.$disconnect();
});

/** Completes the Run's Review, so its downloads exist. */
const complete = async (id: RunId, cookie?: string) => {
  const res = request(app).post(`/runs/${id}/review`).send({ decisions: acceptAll() });
  const sent = await (cookie ? res.set("Cookie", cookie) : res);
  expect([sent.status, sent.body]).toEqual([202, expect.anything()]);
  await settle();
};

/** Starts a Run and holds it in `extracting` (its CV extraction waits), as the cookie's Account. Release the returned function, then `settle`. */
const startBusyRun = async (cookie: string): Promise<{ id: RunId; release: () => void }> => {
  llm.clearQueues();
  const release = llm.hold("extract_cv");
  enqueueToReview(llm);
  const created = await request(app).post("/runs").set("Cookie", cookie).attach("cv", cvFile, "cv.pdf").field("jobDescription", "A backend developer role.");
  expect(created.status).toBe(201);
  return { id: RunIdSchema.parse(created.body.id), release };
};

type Viewer = "owner" | "other account" | "no session";
const VIEWERS: Viewer[] = ["owner", "other account", "no session"];
const cookieFor = (viewer: Viewer): string | undefined => (viewer === "owner" ? ada : viewer === "other account" ? grace : undefined);
const as = (req: request.Test, cookie?: string) => (cookie ? req.set("Cookie", cookie) : req);

type RouteCase = {
  name: string;
  /** Where the Run is when the route is called. */
  at: "review" | "completed";
  call: (id: string) => request.Test;
  /** What the route normally answers in that state. */
  status: number;
};
const download = (format: string) => (id: string) => request(app).get(`/runs/${id}/cv.${format}`).buffer(true).parse((res, done) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => done(null, Buffer.concat(chunks)));
});
const ROUTES: RouteCase[] = [
  { name: "GET /runs/:id", at: "review", call: (id) => request(app).get(`/runs/${id}`), status: 200 },
  // The stream ends after the first view: a Run waiting for review needs the user.
  { name: "GET /runs/:id/events", at: "review", call: (id) => request(app).get(`/runs/${id}/events`), status: 200 },
  // A Run in review is not waiting for Answers: the owner's normal answer is the 409.
  { name: "POST /runs/:id/answers", at: "review", call: (id) => request(app).post(`/runs/${id}/answers`).send({ answers: [] }), status: 409 },
  { name: "POST /runs/:id/review", at: "review", call: (id) => request(app).post(`/runs/${id}/review`).send({ decisions: acceptAll() }), status: 202 },
  { name: "POST /runs/:id/review/preview", at: "review", call: (id) => request(app).post(`/runs/${id}/review/preview`).send({ decisions: acceptAll() }), status: 200 },
  { name: "GET /runs/:id/cv.pdf", at: "completed", call: download("pdf"), status: 200 },
  { name: "GET /runs/:id/cv.docx", at: "completed", call: download("docx"), status: 200 },
  { name: "DELETE /runs/:id", at: "review", call: (id) => request(app).delete(`/runs/${id}`), status: 204 },
];

describe("every Run route, per viewer", () => {
  describe.each(ROUTES)("$name", (route) => {
    const reach = async (cookie?: string): Promise<RunId> => {
      const id = await startRun(cookie);
      if (route.at === "completed") await complete(id, cookie);
      return id;
    };

    it.each(VIEWERS)("an Owned Run, as %s", async (viewer) => {
      const id = await reach(ada);
      const res = await as(route.call(id), cookieFor(viewer));
      if (viewer === "owner") {
        expect(res.status).toBe(route.status);
      } else {
        expect(res.status).toBe(404);
        // A download is parsed as bytes: read an error body as JSON.
        expect(Buffer.isBuffer(res.body) ? JSON.parse(res.body.toString()) : res.body).toEqual(NOT_FOUND);
      }
      await settle();
      // Whoever asked, an Owned Run that was not the viewer's is still there.
      expect(await store.get(id) !== null).toBe(!(viewer === "owner" && route.name.startsWith("DELETE")));
    });

    it.each(VIEWERS)("a Guest Run, as %s", async (viewer) => {
      const id = await reach();
      const res = await as(route.call(id), cookieFor(viewer));
      expect(res.status).toBe(route.status);
      await settle();
    });

    it("answers a missing Run exactly as it answers someone else's Owned Run", async () => {
      const id = await reach(ada);
      const other = await as(route.call(id), grace);
      const missing = await as(route.call(randomUUID()), grace);
      expect(other.status).toBe(missing.status);
      expect(other.body).toEqual(missing.body);
      expect(other.headers["content-type"]).toBe(missing.headers["content-type"]);
    });
  });
});

describe("DELETE /runs/:id", () => {
  it("carries the owner check in its delete statement, so a race cannot delete someone else's Run", async () => {
    const id = await startRun(ada);
    const adaId = (await prisma.run.findUniqueOrThrow({ where: { id } })).accountId!;
    // What a request that passed the loader as another viewer would run: nothing is deleted.
    expect(await store.deleteIdleLive(id, [], new Date(), "someone-else")).toBe(false);
    expect(await store.deleteIdleLive(id, [], new Date(), null)).toBe(false);
    expect(await store.get(id)).not.toBeNull();
    expect(await store.deleteIdleLive(id, [], new Date(), adaId)).toBe(true);
  });
});

describe("POST /runs", () => {
  it("makes an Owned Run for a signed-in Account, expiring owned TTL after creation", async () => {
    const id = await startRun(ada);
    const row = await prisma.run.findUniqueOrThrow({ where: { id } });
    const account = await prisma.user.findUniqueOrThrow({ where: { email: ADA.email } });
    expect(row.accountId).toBe(account.id);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
  });

  it("makes a Guest Run without a session, expiring after the Guest TTL", async () => {
    const id = await startRun();
    const row = await prisma.run.findUniqueOrThrow({ where: { id } });
    expect(row.accountId).toBeNull();
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("POST /runs/claim", () => {
  const claim = (body: unknown, cookie?: string) => as(request(app).post("/runs/claim").send(body as object), cookie);

  it("claims a Guest Run: the Account then sees it, expiring owned TTL after its creation", async () => {
    const id = await startRun();
    expect((await request(app).get(`/runs/${id}`).set("Cookie", ada)).status).toBe(200);

    const res = await claim({ runIds: [id] }, ada);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ claimed: [id] });

    const row = await prisma.run.findUniqueOrThrow({ where: { id } });
    expect(row.accountId).not.toBeNull();
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(90 * 24 * 60 * 60 * 1000);
    expect((await request(app).get(`/runs/${id}`).set("Cookie", ada)).body.expiresAt).toBe(row.expiresAt.toISOString());
    // Now it is Ada's alone.
    const other = await request(app).get(`/runs/${id}`).set("Cookie", grace);
    expect(other.status).toBe(404);
    expect((await request(app).get(`/runs/${id}`)).status).toBe(404);
  });

  it("ignores another Account's Owned Run, an expired Run, a missing Run and a malformed ID, and claims the rest", async () => {
    const guest = await startRun();
    const owned = await startRun(grace);
    const expired = await startRun();
    await prisma.run.update({ where: { id: expired }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const before = await prisma.run.findUniqueOrThrow({ where: { id: owned } });

    const res = await claim({ runIds: [owned, expired, randomUUID(), "not-an-id", guest, guest] }, ada);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ claimed: [guest] });

    expect(await prisma.run.findUniqueOrThrow({ where: { id: owned } })).toEqual(before);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: expired } })).accountId).toBeNull();
  });

  it("accepts 50 IDs and refuses 51 with 400 BAD_REQUEST, claiming nothing", async () => {
    const guest = await startRun();
    const fifty = [guest, ...Array.from({ length: 49 }, () => randomUUID())];
    expect((await claim({ runIds: fifty }, ada)).body).toEqual({ claimed: [guest] });

    const guest2 = await startRun();
    const tooMany = await claim({ runIds: [guest2, ...Array.from({ length: 50 }, () => randomUUID())] }, ada);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.code).toBe("BAD_REQUEST");
    expect((await prisma.run.findUniqueOrThrow({ where: { id: guest2 } })).accountId).toBeNull();
  });

  it.each([{}, { runIds: [] }, { runIds: "x" }, { runIds: [1] }])("refuses the body %j with 400", async (body) => {
    const res = await claim(body, ada);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_REQUEST");
  });

  it("is 401 UNAUTHENTICATED without a session, and claims nothing", async () => {
    const guest = await startRun();
    const res = await claim({ runIds: [guest] });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
    expect((await prisma.run.findUniqueOrThrow({ where: { id: guest } })).accountId).toBeNull();
  });
});

describe("GET /runs (My Runs)", () => {
  const list = (cookie?: string) => as(request(app).get("/runs"), cookie);

  it("is 401 UNAUTHENTICATED without a session", async () => {
    const res = await list();
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("is empty for an Account with no Runs", async () => {
    const res = await list(ada);
    expect(res.status).toBe(200);
    expect(MyRunsSchema.parse(res.body)).toEqual({ runs: [] });
  });

  it("lists the Account's unexpired Owned Runs newest first, with the job and Match Score, and no one else's", async () => {
    const oldest = await startRun(ada);
    const middle = await startRun(ada);
    const newest = await startRun(ada);
    const expired = await startRun(ada);
    await startRun(grace);
    await startRun();
    const base = Date.now();
    for (const [i, id] of [oldest, middle, newest, expired].entries()) {
      await prisma.run.update({ where: { id }, data: { createdAt: new Date(base - (4 - i) * 60_000) } });
    }
    await prisma.run.update({ where: { id: expired }, data: { expiresAt: new Date(base - 1000) } });

    const res = await list(ada);
    expect(res.status).toBe(200);
    const { runs } = MyRunsSchema.parse(res.body);
    expect(runs.map((r) => r.id)).toEqual([newest, middle, oldest]);
    const view = (await request(app).get(`/runs/${newest}`).set("Cookie", ada)).body;
    expect(runs[0]).toEqual({
      id: newest,
      status: "awaiting_review",
      createdAt: (await prisma.run.findUniqueOrThrow({ where: { id: newest } })).createdAt.toISOString(),
      jobTitle: view.job.title,
      company: view.job.company,
      matchScore: view.score.after,
    });
    expect(RunSummarySchema.parse(runs[0]).matchScore).not.toBeNull();
  });

  it("gives null for the job and the Match Score of a Run with no Job Profile yet", async () => {
    const { id, release } = await startBusyRun(ada);

    const res = await list(ada);
    const { runs } = MyRunsSchema.parse(res.body);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ id, status: "extracting", jobTitle: null, company: null, matchScore: null });
    release();
    await settle();
  });
});

describe("DELETE /account", () => {
  it("is 401 UNAUTHENTICATED without a session", async () => {
    const res = await request(app).delete("/account");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("answers 409 RUN_BUSY while a Run is working, and deletes nothing", async () => {
    await startRun(ada);
    const { release } = await startBusyRun(ada);

    const res = await request(app).delete("/account").set("Cookie", ada);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RUN_BUSY");
    expect(await prisma.run.count()).toBe(2);
    expect(await prisma.user.count({ where: { email: ADA.email } })).toBe(1);
    expect((await request(app).get("/account").set("Cookie", ada)).status).toBe(200);

    release();
    await settle();
  });
});
