import { RunViewSchema, type RunId } from "@resume-ai/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { layoutCv } from "@/export/layout.js";
import { renderPdf } from "@/export/pdfRenderer.js";
import { sizesForStep } from "@/export/sizes.js";
import { assignCvIds } from "@/extraction/assignIds.js";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { bootReview, type ReviewProcess } from "../fakes/reviewRun.js";
import { longCv, longExtracted } from "../fixtures/longCv.js";
import { extractedJob } from "../runFixtures.js";

// Review fit: drops, the preview, `CV_TOO_LONG` on submit, and `fit` in the view. The Runs are on the made-up long CV
// (about a page and a half at the smallest size), rendered to a real PDF so the Run parses it.

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);

const job = { ...extractedJob, requirements: [{ text: "Kubernetes", source: "Kubernetes", kind: "skill", importance: "must_have" }] };
const coverage = { verdicts: [{ requirementId: "req1", reason: "r", evidenceIds: ["exp1.b1"], verdict: "met" }] };
const cv = longCv();
/** Condensing on this Run: cd1.c1 shortens exp2.b1 and cd2.c1 removes exp3.b2. Neither is cited, so there is no re-judge. */
const REWORD = { rewordings: [{ targetItemId: "exp2.b1", text: "Built the stock reservation service." }] };
const REMOVE = { drops: [{ targetItemId: "exp3.b2", rationale: "Least relevant" }] };

let cvFile: Buffer;
let hugeFile: Buffer;
beforeAll(async () => {
  cvFile = (await renderPdf(layoutCv(cv), sizesForStep(0))).buffer;
  hugeFile = (await renderPdf(layoutCv(assignCvIds(hugeExtracted())), sizesForStep(0))).buffer;
});
/** The long CV with a summary so long that not even one bullet per job fits one page. */
function hugeExtracted() {
  return { ...longExtracted, summary: "Platform engineer who keeps long running services healthy for many different teams. ".repeat(60) };
}

let p: ReviewProcess;
let id: RunId;
const post = (path: string, body: unknown, runId: string = id) => request(p.app).post(`/runs/${runId}${path}`).send(body as object);
const view = async () => (await request(p.app).get(`/runs/${id}`)).body;

/** A Run on `file` held at Review: reword and remove Changes from condensing (cd1.c1, cd2.c1). */
async function reach(file: Buffer, extracted: unknown): Promise<RunId> {
  p.llm
    .enqueue("extract_job_profile", job)
    .enqueue("extract_cv", extracted)
    .enqueueVoted("assess_coverage", coverage)
    .enqueue("condense_reword", REWORD)
    .enqueue("claim_check", { verdicts: [{ id: "cd1.c1", reason: "r", verdict: "supported" }] })
    .enqueue("condense_drop", REMOVE, { drops: [] });
  const runId = await p.service.createRun({ cv: file, jobDescription: "Platform engineer" });
  await p.settle();
  return runId;
}

beforeEach(async () => {
  await store.deleteAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  p = bootReview(store, config);
  id = await reach(cvFile, longExtracted);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const bullets = [...cv.experience, ...cv.education, ...cv.projects].flatMap((e) => e.bullets.map((b) => b.id));
const accepted = { decisions: [{ changeId: "cd1.c1", decision: "accept" }, { changeId: "cd2.c1", decision: "accept" }] };
const fittingDrops = () => bullets.filter((b) => !b.endsWith(".b1") && b !== "exp3.b2");

describe("the Run's setup", () => {
  it("holds the condense Changes at Review", async () => {
    const v = await view();
    expect(v.status).toBe("awaiting_review");
    expect(v.changes.map((c: { id: string }) => c.id)).toEqual(["cd1.c1", "cd2.c1"]);
  });
});

describe("POST /runs/:id/review/preview", () => {
  it("reports a CV that is over, and that the minimal CV fits", async () => {
    const res = await post("/review/preview", accepted);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fits: false, fittable: true });
    expect(res.body.overByLines).toBeGreaterThan(0);
  });

  it("reports a CV that fits, with its size step", async () => {
    const res = await post("/review/preview", { ...accepted, drops: fittingDrops() });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fits: true, fittable: true });
    expect(res.body.step).toBeGreaterThanOrEqual(0);
  });

  it("reports that the CV cannot fit when even the minimal CV is too long", async () => {
    p = bootReview(store, config);
    id = await reach(hugeFile, hugeExtracted());
    const res = await post("/review/preview", accepted);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fits: false, fittable: false });
  });

  it("changes nothing: the status, the Changes and the view stay as they were, and the Review can still be submitted", async () => {
    const before = await view();
    await post("/review/preview", { ...accepted, drops: ["exp1.b2"] });
    await p.settle();
    expect(await view()).toEqual(before);
    expect(before.changes.every((c: { status: string }) => c.status === "proposed")).toBe(true);
    // Still paused: a Review that fits goes through.
    expect((await post("/review", { ...accepted, drops: fittingDrops() })).status).toBe(202);
  });

  it("answers 409 RUN_NOT_AWAITING_REVIEW outside awaiting_review", async () => {
    await store.setStatus(id, "tailoring");
    const res = await post("/review/preview", accepted);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RUN_NOT_AWAITING_REVIEW");
  });

  it("answers 404 for an unknown or malformed Run", async () => {
    for (const unknown of ["00000000-0000-4000-8000-000000000000", "not-an-id"]) {
      const res = await post("/review/preview", accepted, unknown);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("RUN_NOT_FOUND");
    }
  });

  it("validates like the Review: the same 400s", async () => {
    const res = await post("/review/preview", { decisions: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REVIEW");
  });
});

describe("drops", () => {
  const rejectsWith400 = async (body: unknown, path = "/review") => {
    const res = await post(path, body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REVIEW");
    await p.settle();
    expect((await view()).status).toBe("awaiting_review");
    return res;
  };

  it.each(["/review", "/review/preview"])("answers 400 for an unknown Item (%s)", async (path) => {
    expect((await rejectsWith400({ ...accepted, drops: ["exp9.b1"] }, path)).body.message).toContain("exp9.b1");
  });
  it("answers 400 for an Item that is not a bullet", async () => {
    expect((await rejectsWith400({ ...accepted, drops: ["exp1"] })).body.message).toContain("exp1");
    expect((await rejectsWith400({ ...accepted, drops: ["skill1"] })).body.message).toContain("skill1");
  });
  it("answers 400 for a repeated drop", async () => {
    expect((await rejectsWith400({ ...accepted, drops: ["exp1.b2", "exp1.b2"] })).body.message).toContain("exp1.b2");
  });
  it("answers 400 for a drop of the last bullet, naming the entry", async () => {
    const res = await rejectsWith400({ ...accepted, drops: ["exp1.b1", "exp1.b2", "exp1.b3", "exp1.b4", "exp1.b5"] });
    expect(res.body.message).toContain("exp1");
  });
  it("answers 400 for a drop of a bullet an accepted remove already removes", async () => {
    expect((await rejectsWith400({ ...accepted, drops: ["exp3.b2"] })).body.message).toContain("exp3.b2");
  });
  it("answers 400 for a drop of a reworded bullet unless its Change is rejected", async () => {
    expect((await rejectsWith400({ ...accepted, drops: ["exp2.b1"] })).body.message).toContain("reject its Change");
    const rejected = { decisions: [{ changeId: "cd1.c1", decision: "reject" }, { changeId: "cd2.c1", decision: "accept" }], drops: ["exp2.b1"] };
    expect((await post("/review/preview", rejected)).status).toBe(200);
  });
  it("accepts a drop of a cited bullet", async () => {
    // exp1.b1 is cited by the met Requirement; the model could not drop it, the user may.
    const drops = [...fittingDrops().filter((b) => b !== "exp1.b2"), "exp1.b1"];
    const res = await post("/review", { ...accepted, drops });
    expect(res.status).toBe(202);
  });
  it("accepts a body without drops, as older clients send it", async () => {
    const res = await post("/review/preview", accepted);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ fits: false });
  });
  it("answers 400 when drops is not a list of Item IDs", async () => {
    await rejectsWith400({ ...accepted, drops: "exp1.b2" });
    await rejectsWith400({ ...accepted, drops: [1] });
  });
});

describe("POST /runs/:id/review fit", () => {
  it("answers 400 CV_TOO_LONG with overByLines when the result is over and the minimal CV fits, and the Run still waits", async () => {
    const res = await post("/review", accepted);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("CV_TOO_LONG");
    expect(res.body.overByLines).toBeGreaterThan(0);
    await p.settle();
    const v = await view();
    expect(v.status).toBe("awaiting_review");
    expect(v.changes.every((c: { status: string }) => c.status === "proposed")).toBe(true);
  });

  it("resumes and completes a Review that fits, with the dropped bullets gone", async () => {
    const res = await post("/review", { ...accepted, drops: fittingDrops() });
    expect(res.status).toBe(202);
    await p.settle();
    const v = RunViewSchema.parse(await view());
    expect(v.status).toBe("completed");
    const left = v.status === "completed" ? v.cv.experience[0]!.bullets.map((b) => b.id) : [];
    expect(left).toEqual(["exp1.b1"]);
    expect("fit" in v).toBe(false);
  });

  it("accepts the Review as submitted when even the minimal CV does not fit", async () => {
    p = bootReview(store, config);
    id = await reach(hugeFile, hugeExtracted());
    const res = await post("/review", accepted);
    expect(res.status).toBe(202);
    await p.settle();
    expect((await view()).status).toBe("completed");
  });
});

describe("the view's originalCv", () => {
  const bulletIds = (v: { experience: { bullets: { id: string }[] }[] }) => v.experience.flatMap((e) => e.bullets.map((b) => b.id));

  it("keeps the bullet a remove Change drops from cv, at awaiting_review and at completed", async () => {
    const review = RunViewSchema.parse(await view());
    if (review.status !== "awaiting_review") throw new Error("expected awaiting_review");
    expect(bulletIds(review.originalCv)).toContain("exp3.b2");
    expect(bulletIds(review.cv)).not.toContain("exp3.b2");
    expect(review.originalCv.experience[1]!.bullets[0]!.text).toBe(cv.experience[1]!.bullets[0]!.text);

    await post("/review", { ...accepted, drops: fittingDrops() });
    await p.settle();
    const done = RunViewSchema.parse(await view());
    if (done.status !== "completed") throw new Error("expected completed");
    expect(bulletIds(done.originalCv)).toEqual(bulletIds(review.originalCv));
    expect(bulletIds(done.cv)).not.toContain("exp3.b2");
  });
});

describe("the view's fit", () => {
  it("is in awaiting_review, with every Change accepted and no drops", async () => {
    const v = await view();
    expect(v.fit).toMatchObject({ fits: false, fittable: true });
    expect(v.fit.overByLines).toBeGreaterThan(0);
    RunViewSchema.parse(v);
  });

  it("is not in tailoring, completed or any other status", async () => {
    await store.setStatus(id, "tailoring");
    expect("fit" in (await view())).toBe(false);
    await store.setStatus(id, "awaiting_review");
    await post("/review", { ...accepted, drops: fittingDrops() });
    await p.settle();
    const done = await view();
    expect(done.status).toBe("completed");
    expect("fit" in done).toBe(false);
  });
});
