import type { RunId } from "@resume-ai/shared";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { bootReview, decisions, reachReview, type ReviewProcess } from "../fakes/reviewRun.js";
import { longCv } from "../export/exportCv.js";

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const FORMATS = [
  { format: "pdf", contentType: "application/pdf", magic: "%PDF" },
  { format: "docx", contentType: DOCX_TYPE, magic: "PK" },
] as const;

let p: ReviewProcess;
let id: RunId;
const get = (runId: string, format: string) =>
  request(p.app)
    .get(`/runs/${runId}/cv.${format}`)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => done(null, Buffer.concat(chunks)));
    });
const complete = async () => {
  await p.service.submitReview(id, { decisions: decisions() });
  await p.settle();
};

beforeEach(async () => {
  await store.deleteAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  p = bootReview(store, config);
  id = await reachReview(p);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /runs/:id/cv.(pdf|docx)", () => {
  it.each(FORMATS)("sends the completed CV as a $format attachment with the right headers and a real file", async ({ format, contentType, magic }) => {
    await complete();
    const res = await get(id, format);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe(contentType);
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="tailored-cv.${format}"`);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((res.body as Buffer).subarray(0, magic.length).toString("latin1")).toBe(magic);
  });

  it.each(FORMATS)("answers 404 for an unknown or malformed Run ID ($format)", async ({ format }) => {
    for (const unknown of ["00000000-0000-4000-8000-000000000000", "not-an-id"]) {
      const res = await request(p.app).get(`/runs/${unknown}/cv.${format}`);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("RUN_NOT_FOUND");
    }
  });

  it.each(FORMATS)("answers 404 for an expired Run ($format)", async ({ format }) => {
    await complete();
    const late = bootReview(store, config, p.checkpointer, () => new Date(Date.now() + 365 * 24 * 3600 * 1000));
    const res = await request(late.app).get(`/runs/${id}/cv.${format}`);
    expect(res.status).toBe(404);
  });

  it.each(FORMATS)("answers 409 RUN_NOT_COMPLETED while the Run is in review ($format)", async ({ format }) => {
    const res = await request(p.app).get(`/runs/${id}/cv.${format}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RUN_NOT_COMPLETED");
  });

  it.each(FORMATS)("answers 409 CV_TOO_LONG when the CV does not fit one page at the smallest size ($format)", async ({ format }) => {
    await complete();
    const real = p.runner.read.bind(p.runner);
    vi.spyOn(p.runner, "read").mockImplementation(async (runId) => {
      const state = await real(runId);
      return state && { ...state, cv: longCv(4, 6), changes: [] };
    });
    const res = await request(p.app).get(`/runs/${id}/cv.${format}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CV_TOO_LONG");
    expect(res.body.message).not.toContain("Nora");
  });
});

describe("the download links in GET /runs/:id", () => {
  it("holds both links once the Run is completed, even when the CV is too long to export", async () => {
    await complete();
    const view = (await request(p.app).get(`/runs/${id}`)).body;
    expect(view.status).toBe("completed");
    expect(view.download).toEqual({ docx: `/runs/${id}/cv.docx`, pdf: `/runs/${id}/cv.pdf` });
  });

  it("is absent for the other statuses", async () => {
    const review = (await request(p.app).get(`/runs/${id}`)).body;
    expect(review.status).toBe("awaiting_review");
    expect(review.download).toBeUndefined();
    await store.setStatus(id, "tailoring");
    expect((await request(p.app).get(`/runs/${id}`)).body.download).toBeUndefined();
  });
});
