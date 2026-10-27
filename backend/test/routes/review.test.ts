import { RunViewSchema, type RunId } from "@resume-ai/shared";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { bootReview, decisions, reachReview, type ReviewProcess } from "../fakes/reviewRun.js";

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);

let p: ReviewProcess;
let id: RunId;
const post = (runId: string, body: unknown) => request(p.app).post(`/runs/${runId}/review`).send(body as object);
const statusOf = async () => (await request(p.app).get(`/runs/${id}`)).body.status;

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

describe("POST /runs/:id/review", () => {
  it("answers 202 with the Run ID, resumes the graph, and ends completed", async () => {
    expect(await statusOf()).toBe("awaiting_review");
    const res = await post(id, { decisions: decisions() });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ id });
    await p.settle();
    const view = RunViewSchema.parse((await request(p.app).get(`/runs/${id}`)).body);
    expect(view.status).toBe("completed");
  });

  it("answers 409 RUN_NOT_AWAITING_REVIEW to a second submission and resumes only once", async () => {
    expect((await post(id, { decisions: decisions() })).status).toBe(202);
    const again = await post(id, { decisions: decisions() });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("RUN_NOT_AWAITING_REVIEW");
    await p.settle();
    expect(await statusOf()).toBe("completed");
  });

  it("answers 409 when the Run is not waiting for review", async () => {
    await store.setStatus(id, "tailoring");
    const res = await post(id, { decisions: decisions() });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RUN_NOT_AWAITING_REVIEW");
  });

  it("answers 404 for an unknown or malformed Run ID", async () => {
    for (const unknown of ["00000000-0000-4000-8000-000000000000", "not-an-id"]) {
      const res = await post(unknown, { decisions: [] });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("RUN_NOT_FOUND");
    }
  });

  it("answers 404 for an expired Run", async () => {
    const late = bootReview(store, config, p.checkpointer, () => new Date(Date.now() + 365 * 24 * 3600 * 1000));
    const res = await request(late.app).post(`/runs/${id}/review`).send({ decisions: decisions() });
    expect(res.status).toBe(404);
  });

  const rejectsWith400 = async (body: unknown) => {
    const res = await post(id, body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_REVIEW");
    // Nothing was resumed: the Run still waits.
    await p.settle();
    expect(await statusOf()).toBe("awaiting_review");
    return res;
  };
  const revise = (changeId: string, fields: Record<string, unknown>) => decisions({ [changeId]: { decision: "revise", ...fields } });

  it("answers 400 when decisions is missing or not a list", async () => {
    await rejectsWith400({});
    await rejectsWith400({ decisions: "accept" });
  });
  it("answers 400 for a decision that fails the schema", async () => {
    await rejectsWith400({ decisions: decisions({ "r1.c1": { decision: "maybe" } }) });
  });
  it("answers 400 when a Change has no decision", async () => {
    await rejectsWith400({ decisions: decisions().slice(1) });
  });
  it("answers 400 for a repeated changeId", async () => {
    await rejectsWith400({ decisions: [...decisions(), { changeId: "r1.c1", decision: "reject" }] });
  });
  it("answers 400 for an unknown changeId", async () => {
    await rejectsWith400({ decisions: [...decisions(), { changeId: "r9.c9", decision: "reject" }] });
  });
  it("answers 400 for a revised replace with no text", async () => {
    await rejectsWith400({ decisions: revise("r1.c1", {}) });
  });
  it("answers 400 for a revised add whose text is blank after trimming", async () => {
    await rejectsWith400({ decisions: revise("r1.c2", { after: "   " }) });
  });
  it("answers 400 for a revised reorder with no orderedItemIds", async () => {
    await rejectsWith400({ decisions: revise("r1.c3", {}) });
  });
  it("answers 400 for a revised replace that carries orderedItemIds", async () => {
    await rejectsWith400({ decisions: revise("r1.c1", { after: "Built Node.js services.", orderedItemIds: ["skill1"] }) });
  });
  it("answers 400 for a revised reorder that carries after", async () => {
    await rejectsWith400({ decisions: revise("r1.c3", { orderedItemIds: ["skill1", "skill2", "skill3"], after: "x" }) });
  });
  it.each([
    ["accept", { after: "text" }],
    ["reject", { orderedItemIds: ["skill1"] }],
  ])("answers 400 for a %s that carries revision fields", async (decision, fields) => {
    await rejectsWith400({ decisions: decisions({ "r1.c1": { decision, ...fields } }) });
  });
  it("answers 400 for a revision that fails stage 1 (a new number), and the message does not echo the text", async () => {
    const res = await rejectsWith400({ decisions: revise("r1.c1", { after: "Designed Node.js services serving 99999 users." }) });
    expect(res.body.message).not.toContain("99999");
    expect(res.body.message).toContain("r1.c1");
  });
  it("answers 400 for a reorder revision that is not a permutation", async () => {
    await rejectsWith400({ decisions: revise("r1.c3", { orderedItemIds: ["skill1"] }) });
  });
  it("answers 400 to a body that is not JSON", async () => {
    const res = await request(p.app).post(`/runs/${id}/review`).set("Content-Type", "application/json").send("{nope");
    expect(res.status).toBe(400);
    expect(await statusOf()).toBe("awaiting_review");
  });

  it("accepts valid revisions (trimmed text, a permutation)", async () => {
    const res = await post(id, { decisions: [...revise("r1.c1", { after: "  Built Node.js services on PostgreSQL.  " }).slice(0, 1), ...revise("r1.c3", { orderedItemIds: ["skill2", "skill3", "skill1"] }).slice(1)] });
    expect(res.status).toBe(202);
  });
});
