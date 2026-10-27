import { RunViewSchema, type RunId } from "@resume-ai/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { COVERAGE_CALLS_BEFORE_REVIEW, ALL_MET, CHANGE_IDS, bootReview, decisions, only, reachReview, type ReviewProcess } from "../fakes/reviewRun.js";

const config = loadConfig(process.env);
const prisma = createPrisma(config.databaseUrl);
const store = new RunStore(prisma);
const STARTED_AT = new Date(Date.now() + 60_000);

let p: ReviewProcess;
let id: RunId;
let errors: string[];

/** The prompts of the `assess_coverage` calls made after Review was submitted. */
const finalJudgeCalls = (process: ReviewProcess) =>
  process.llm.calls.filter((c) => c.name === "assess_coverage").slice(COVERAGE_CALLS_BEFORE_REVIEW).map((c) => JSON.stringify(c.messages));
const submit = async (body: unknown) => {
  await p.service.submitReview(id, body);
  await p.settle();
};
const view = async () => {
  const v = await p.service.getRunView(id);
  expect(RunViewSchema.safeParse(v).success).toBe(true);
  return v;
};

beforeEach(async () => {
  await store.deleteAll();
  errors = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((line: unknown) => void errors.push(String(line)));
  p = bootReview(store, config);
  id = await reachReview(p);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("the Review and the final re-judge", () => {
  it("accept-all calls the judge zero times, ends completed and keeps the score", async () => {
    const before = await view();
    if (before.status !== "awaiting_review") throw new Error("expected awaiting_review");
    await submit({ decisions: decisions() });

    expect(finalJudgeCalls(p)).toEqual([]);
    const after = await view();
    expect(after.status).toBe("completed");
    if (after.status !== "completed") return;
    expect(after.score).toEqual(before.score);
    expect(after.changes.map((c) => c.status)).toEqual(["accepted", "accepted", "accepted"]);
    expect(after.cv).toEqual(before.cv);
    expect(after.download).toEqual({ docx: `/runs/${after.id}/cv.docx`, pdf: `/runs/${after.id}/cv.pdf` });
  });

  it("a reject re-judges only the Requirements it lists, against a CV without the Change", async () => {
    p.llm.enqueueVoted("assess_coverage", only("req3", "unmet"));
    await submit({ decisions: decisions({ "r1.c2": { decision: "reject" } }) });

    const calls = finalJudgeCalls(p);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call).toContain("[req3]");
      expect(call).not.toContain("[req1]");
      expect(call).not.toContain("[req2]");
      expect(call).not.toContain("[skill3]");
    }
    const v = await view();
    if (v.status !== "completed") throw new Error(`expected completed, got ${v.status}`);
    expect(v.requirements.map((r) => r.after.verdict)).toEqual(["met", "met", "unmet"]);
    expect(v.score.after).toBeLessThan(100);
    expect(v.changes.map((c) => c.status)).toEqual(["accepted", "rejected", "accepted"]);
    expect(v.cv.skills.map((s) => s.text)).toEqual(["Node.js", "TypeScript"]);
  });

  it("a revise re-judges against the user's own text, and with it every Requirement that cites the revised bullet", async () => {
    // r1.c1 lists req2, and all three verdicts cite its target exp1.b1.
    p.llm.enqueueVoted("assess_coverage", ALL_MET);
    await submit({ decisions: decisions({ "r1.c1": { decision: "revise", after: "  Built PostgreSQL-backed Node.js APIs.  " } }) });

    const calls = finalJudgeCalls(p);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call).toContain("Built PostgreSQL-backed Node.js APIs.");
      for (const requirement of ["[req1]", "[req2]", "[req3]"]) expect(call).toContain(requirement);
    }
    const v = await view();
    if (v.status !== "completed") throw new Error(`expected completed, got ${v.status}`);
    const revised = v.changes.find((c) => c.id === "r1.c1")!;
    expect(revised).toMatchObject({ status: "revised", after: "Built PostgreSQL-backed Node.js APIs." });
    expect(v.cv.experience[0]!.bullets[0]!.text).toBe("Built PostgreSQL-backed Node.js APIs.");
  });

  it("a failing judge ends completed with the affected verdicts (those listed by or citing the undone Changes) back at coverageBefore and the score recomputed", async () => {
    // Nothing queued for assess_coverage: every judge call fails.
    await submit({ decisions: decisions({ "r1.c1": { decision: "reject" }, "r1.c2": { decision: "reject" } }) });

    const v = await view();
    expect(v.status).toBe("completed");
    if (v.status !== "completed") return;
    expect(v.requirements.map((r) => r.after.verdict)).toEqual(["met", "unmet", "unmet"]);
    expect(v.score.after).toBe(v.score.before);
    expect(errors.some((e) => e.startsWith(`Run ${id}: final re-judge failed, 3 verdicts reverted`))).toBe(true);
  });

  it("the completed view excludes rejected Changes and carries the final statuses", async () => {
    p.llm.enqueueVoted("assess_coverage", only("req2", "unmet"));
    await submit({ decisions: decisions({ "r1.c1": { decision: "reject" } }) });
    const v = await view();
    if (v.status !== "completed") throw new Error(`expected completed, got ${v.status}`);
    expect(v.cv.experience[0]!.bullets[0]!.text).toBe("Designed and maintained Node.js services backed by PostgreSQL.");
    expect(v.changes.map((c) => [c.id, c.status])).toEqual(CHANGE_IDS.map((c, i) => [c, i === 0 ? "rejected" : "accepted"]));
  });

  it("shows tailoring with the review step running during the final re-judge", async () => {
    const release = p.llm.hold("assess_coverage");
    p.llm.enqueueVoted("assess_coverage", ALL_MET);
    await p.service.submitReview(id, { decisions: decisions({ "r1.c2": { decision: "reject" } }) });
    const start = Date.now();
    while (!p.llm.held.includes("assess_coverage") && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 5));
    const v = await view();
    expect(v.status).toBe("tailoring");
    expect(v.steps.find((s) => s.key === "review")?.state).toBe("running");
    release();
    await p.settle();
    expect((await view()).status).toBe("completed");
  });
});

describe("recovery during the final re-judge", () => {
  it("resumes a Run cut off in the final re-judge and ends it completed", async () => {
    p.llm.hold("assess_coverage");
    await p.service.submitReview(id, { decisions: decisions({ "r1.c2": { decision: "reject" } }) });
    const start = Date.now();
    while (!p.llm.held.includes("assess_coverage") && Date.now() - start < 3000) await new Promise((r) => setTimeout(r, 5));
    expect((await store.get(id))?.status).toBe("tailoring");

    const after = bootReview(store, config, p.checkpointer);
    after.llm.enqueueVoted("assess_coverage", only("req3", "unmet"));
    await after.service.recoverRuns(STARTED_AT);

    expect((await store.get(id))?.status).toBe("completed");
    const v = await after.service.getRunView(id);
    expect(v.status).toBe("completed");
    // The resumed process judged only the rejected Change's Requirement, once (three votes).
    expect(after.llm.calls.filter((c) => c.name === "assess_coverage")).toHaveLength(3);
  });
});
