import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunErrorCode, RunId, RunStatus } from "@resume-ai/shared";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/utils/config.js";
import { ApiError } from "@/utils/errors.js";
import type { NewRun, RunStore, StoredRun } from "@/stores/runs.js";
import { RunsService } from "@/services/runs.js";
import { ExtractionError, NoRequirementsError } from "@/extraction/errors.js";
import { LlmSchemaError, LlmUnavailableError } from "@/llm/llmClient.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { makeGraphRunner } from "../fakes/runGraph.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";

const cv = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));
const config = loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k" });

/** In-memory stand-in for the Prisma-backed store, so the service is tested without a database. */
class FakeStore {
  rows = new Map<string, StoredRun>();
  /** Every status written, in order, per Run. */
  statusLog: RunStatus[] = [];
  async create(run: NewRun): Promise<StoredRun> {
    const stored = { ...run, exportPath: null, error: null };
    this.rows.set(run.id, stored);
    return stored;
  }
  async get(id: RunId): Promise<StoredRun | null> {
    return this.rows.get(id) ?? null;
  }
  async setStatus(id: RunId, status: RunStatus): Promise<void> {
    this.statusLog.push(status);
    this.rows.set(id, { ...this.rows.get(id)!, status });
  }
  async markFailed(id: RunId, code: RunErrorCode, message: string): Promise<void> {
    this.rows.set(id, { ...this.rows.get(id)!, status: "failed", error: { code, message } });
  }
}

const JOB_PROFILE = extractedJob;
const COVERAGE_ANSWER = coverageAnswer;

function setup(now = () => new Date(), judgeLlm?: FakeLlmClient) {
  const store = new FakeStore();
  const llm = new FakeLlmClient();
  const graphRunner = makeGraphRunner(store, llm, judgeLlm);
  // Tasks are held back until `settle`, so a test can look at the Run before the pipeline starts.
  const tasks: (() => Promise<void>)[] = [];
  const runInBackground = (task: () => Promise<void>) => {
    tasks.push(task);
  };
  const service = new RunsService({ store: store as unknown as RunStore, config, graphRunner, now, runInBackground });
  /** Runs every scheduled task and waits for it. A task that rejected fails the test. */
  const settle = async () => {
    await Promise.all(tasks.map((task) => task()));
  };
  return { store, llm, tasks, settle, service };
}

/** Queues a full successful pipeline: extraction, then the first Coverage. */
function enqueueHappyPath(llm: FakeLlmClient) {
  llm.enqueue("extract_job_profile", JOB_PROFILE).enqueue("extract_cv", extractedCv).enqueue("assess_coverage", COVERAGE_ANSWER);
}

const createExtractableRun = (ctx: ReturnType<typeof setup>) => ctx.service.createRun({ cv, jobDescription: "Backend developer" });

const stepStates = (view: { steps: { key: string; state: string }[] }) =>
  view.steps.filter((s) => s.state !== "pending").map((s) => `${s.key}:${s.state}`);

const code = (error: unknown) => (error instanceof ApiError ? error.code : error);

describe("RunsService", () => {
  it("hands the parsed CV and the trimmed job description to extraction", async () => {
    const ctx = setup();
    enqueueHappyPath(ctx.llm);
    await ctx.service.createRun({ cv, jobDescription: "  Backend developer \u0000 " });
    await ctx.settle();
    const [jobCall, cvCall] = ctx.llm.calls;
    expect(JSON.stringify(jobCall!.messages)).toContain("Backend developer");
    expect(JSON.stringify(jobCall!.messages)).not.toContain("\\u0000");
    expect(JSON.stringify(cvCall!.messages)).toContain("Jane Doe");
  });

  it("sets the creation time and the expiry from the same clock", async () => {
    const start = new Date("2026-10-01T00:00:00Z");
    const { store, service } = setup(() => start);
    const id = await service.createRun({ cv, jobDescription: "Backend developer" });
    const row = store.rows.get(id)!;
    expect(row.createdAt).toEqual(start);
    expect(row.expiresAt.getTime()).toBe(start.getTime() + config.runTtlMs);
  });

  it("rejects an empty or over-long job description before parsing the CV", async () => {
    const { store, service } = setup();
    const garbage = Buffer.from("not a cv");
    expect(code(await service.createRun({ cv: garbage, jobDescription: "   " }).catch((e) => e))).toBe("BAD_REQUEST");
    const long = "x".repeat(config.limits.maxJobDescriptionChars + 1);
    expect(code(await service.createRun({ cv: garbage, jobDescription: long }).catch((e) => e))).toBe("JOB_DESCRIPTION_TOO_LONG");
    expect(store.rows.size).toBe(0);
  });

  it("rejects a missing or non-string job description as BAD_REQUEST", async () => {
    const { store, service } = setup();
    for (const jobDescription of [undefined, null, 42, ["a"], { text: "a" }]) {
      expect(code(await service.createRun({ cv, jobDescription }).catch((e) => e))).toBe("BAD_REQUEST");
    }
    expect(store.rows.size).toBe(0);
  });

  it("stops treating a Run as readable once it has expired", async () => {
    let now = new Date("2026-10-01T00:00:00Z");
    const { service } = setup(() => now);
    const id = await service.createRun({ cv, jobDescription: "Backend developer" });
    expect((await service.getRunView(id)).status).toBe("extracting");

    now = new Date(now.getTime() + config.runTtlMs);
    expect(code(await service.getRunView(id).catch((e) => e))).toBe("RUN_NOT_FOUND");
  });

  describe("pipeline", () => {
    it("schedules the pipeline when a Run is created", async () => {
      const ctx = setup();
      enqueueHappyPath(ctx.llm);
      await createExtractableRun(ctx);
      expect(ctx.tasks).toHaveLength(1);
      await ctx.settle();
    });

    it("shows the Run as extracting with extract running before the graph has a checkpoint", async () => {
      const { service } = setup();
      const id = await service.createRun({ cv, jobDescription: "Backend developer" });
      const view = await service.getRunView(id);
      expect(view.status).toBe("extracting");
      expect(view.job).toBeNull();
      expect(stepStates(view)).toEqual(["parse:done", "extract:running"]);
    });

    it("sends Coverage to judgeLlm and extraction to llm", async () => {
      const judgeLlm = new FakeLlmClient().enqueue("assess_coverage", COVERAGE_ANSWER);
      const ctx = setup(undefined, judgeLlm);
      ctx.llm.enqueue("extract_job_profile", JOB_PROFILE).enqueue("extract_cv", extractedCv);
      await createExtractableRun(ctx);
      await ctx.settle();

      expect(ctx.llm.calls.map((c) => c.name)).toEqual(["extract_job_profile", "extract_cv"]);
      expect(judgeLlm.calls.map((c) => c.name)).toEqual(["assess_coverage"]);
    });

    it("uses llm for Coverage when no judge client is given", async () => {
      const ctx = setup();
      enqueueHappyPath(ctx.llm);
      await createExtractableRun(ctx);
      await ctx.settle();
      expect(ctx.llm.calls.map((c) => c.name)).toEqual(["extract_job_profile", "extract_cv", "assess_coverage"]);
    });

    it("ends at awaiting_review with zero rounds when every Requirement is met: before equals after, no Changes, target_reached", async () => {
      const ctx = setup();
      enqueueHappyPath(ctx.llm);
      const id = await createExtractableRun(ctx);
      await ctx.settle();

      const view = await ctx.service.getRunView(id);
      expect(view.status).toBe("awaiting_review");
      if (view.status !== "awaiting_review") return;
      expect(view.score).toEqual({ before: 100, after: 100 });
      expect(view.job).toEqual({ title: "Backend Developer", company: "Initech" });
      expect(view.iterations).toEqual({ used: 0, max: 3 });
      expect(view.exitReason).toBe("target_reached");
      expect(view.changes).toEqual([]);
      expect(view.userEvidence).toEqual([]);
      expect(view.cv.experience[0]?.id).toBe("exp1");
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
      expect(stepStates(view)).toEqual([
        "parse:done",
        "extract:done",
        "coverage:done",
        "questions:done",
        "tailor:done",
        "review:running",
      ]);
    });

    it("rounds the score and keeps requirements in Job Profile order", async () => {
      const ctx = setup();
      ctx.llm
        .enqueue("extract_job_profile", {
          ...JOB_PROFILE,
          requirements: [
            { text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" },
            { text: "PostgreSQL", source: "PostgreSQL", kind: "skill", importance: "must_have" },
            { text: "Docker", source: "Docker", kind: "skill", importance: "nice_to_have" },
          ],
        })
        .enqueue("extract_cv", extractedCv)
        .enqueue("assess_coverage", {
          verdicts: [
            { requirementId: "req3", reason: "No Docker.", evidenceIds: [], verdict: "unmet" },
            { requirementId: "req1", reason: "Built Node.js services.", evidenceIds: ["exp1.b1"], verdict: "met" },
            { requirementId: "req2", reason: "Listed only.", evidenceIds: ["skill1"], verdict: "partially_met" },
          ],
        });
      const id = await createExtractableRun(ctx);
      await ctx.settle();

      const view = await ctx.service.getRunView(id);
      expect(view.status).toBe("awaiting_review");
      if (view.status !== "awaiting_review") return;
      // 100 x (3 + 1.5 + 0) / 7 = 64.28...
      expect(view.score).toEqual({ before: 64, after: 64 });
      expect(view.requirements.map((r) => [r.id, r.before, r.after.verdict])).toEqual([
        ["req1", "met", "met"],
        ["req2", "partially_met", "partially_met"],
        ["req3", "unmet", "unmet"],
      ]);
    });

    // One test per node: the last status the runner wrote (the row starts as extracting, so only a runner write counts).
    it.each([
      ["extract (job profile)", "extract_job_profile", "extracting"],
      ["extract (cv)", "extract_cv", "extracting"],
      ["assess_coverage", "assess_coverage", "extracting"],
    ])("while %s runs the Run is %s", async (_node, call, expected) => {
      const ctx = setup();
      enqueueHappyPath(ctx.llm);
      await createExtractableRun(ctx);
      const seen: RunStatus[] = [];
      const structured = ctx.llm.structured.bind(ctx.llm) as typeof ctx.llm.structured;
      ctx.llm.structured = (async (...args: Parameters<typeof structured>) => {
        if (args[2].name === call) seen.push(ctx.store.statusLog.at(-1)!);
        return structured(...args);
      }) as typeof ctx.llm.structured;
      await ctx.settle();
      expect(seen[0]).toBe(expected);
    });

    it("writes awaiting_review when the graph pauses before review, and nothing after", async () => {
      const ctx = setup();
      enqueueHappyPath(ctx.llm);
      const id = await createExtractableRun(ctx);
      await ctx.settle();
      expect(ctx.store.rows.get(id)!.status).toBe("awaiting_review");
      expect(ctx.store.statusLog).toEqual(["extracting", "awaiting_review"]);
    });

    it("fails with COVERAGE_FAILED after two invalid Coverage answers, keeping the extraction in view", async () => {
      const ctx = setup();
      ctx.llm
        .enqueue("extract_job_profile", JOB_PROFILE)
        .enqueue("extract_cv", extractedCv)
        .enqueue("assess_coverage", new LlmSchemaError("bad", ["a: wrong"]), new LlmSchemaError("bad", ["b: wrong"]));
      const id = await createExtractableRun(ctx);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      await ctx.settle();
      const logged = spy.mock.calls.map((c) => c.map(String).join(" "));
      spy.mockRestore();

      const view = await ctx.service.getRunView(id);
      expect(view.status).toBe("failed");
      if (view.status !== "failed") return;
      expect(view.error.code).toBe("COVERAGE_FAILED");
      expect(view.job).toEqual({ title: "Backend Developer", company: "Initech" });
      expect(stepStates(view)).toEqual(["parse:done", "extract:done", "coverage:failed"]);
      expect(logged).toEqual([`Run ${id}: pipeline failed (COVERAGE_FAILED) CoverageError, 1 issues`]);
    });

    it("turns LlmUnavailableError during Coverage into INTERNAL", async () => {
      const ctx = setup();
      ctx.llm
        .enqueue("extract_job_profile", JOB_PROFILE)
        .enqueue("extract_cv", extractedCv)
        .enqueue("assess_coverage", new LlmUnavailableError("model down"));
      const id = await createExtractableRun(ctx);
      await ctx.settle();

      const view = await ctx.service.getRunView(id);
      expect(view.status).toBe("failed");
      if (view.status !== "failed") return;
      expect(view.error.code).toBe("INTERNAL");
      expect(stepStates(view)).toEqual(["parse:done", "extract:done", "coverage:failed"]);
    });

    it.each([
      ["NoRequirementsError", new NoRequirementsError(), "NO_REQUIREMENTS"],
      ["ExtractionError", new ExtractionError("bad output", ["issue"]), "EXTRACTION_FAILED"],
      ["LlmUnavailableError", new LlmUnavailableError("model down"), "INTERNAL"],
      ["an unexpected error", new Error("boom"), "INTERNAL"],
    ])("turns %s into a failed Run with code %s", async (_name, error, expected) => {
      const ctx = setup();
      ctx.llm.enqueue("extract_job_profile", error);
      const id = await createExtractableRun(ctx);
      await ctx.settle();

      const view = await ctx.service.getRunView(id);
      expect(view.status).toBe("failed");
      if (view.status !== "failed") return;
      expect(view.error.code).toBe(expected);
      expect(view.error.message).not.toContain("boom");
      expect(view.job).toBeNull();
      expect(view.steps.find((s) => s.key === "extract")?.state).toBe("failed");
      expect(ctx.llm.calls.map((c) => c.name)).toEqual(["extract_job_profile"]);
    });

    it("fails when the CV extraction fails, after the Job Profile succeeded", async () => {
      const ctx = setup();
      ctx.llm.enqueue("extract_job_profile", JOB_PROFILE).enqueue("extract_cv", new ExtractionError("bad", []));
      const id = await createExtractableRun(ctx);
      await ctx.settle();
      const view = await ctx.service.getRunView(id);
      expect(view.status).toBe("failed");
      expect(view.job).toBeNull();
    });

    it("never throws when writing the status fails", async () => {
      const ctx = setup();
      enqueueHappyPath(ctx.llm);
      await createExtractableRun(ctx);
      ctx.store.setStatus = async () => {
        throw new Error("db down");
      };
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(ctx.settle()).resolves.toBeUndefined();
      spy.mockRestore();
    });

    it("never throws, even when the store fails to record the failure", async () => {
      const ctx = setup();
      ctx.llm.enqueue("extract_job_profile", new Error("boom"));
      await createExtractableRun(ctx);
      ctx.store.markFailed = async () => {
        throw new Error("db down");
      };
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      await expect(ctx.settle()).resolves.toBeUndefined();
      spy.mockRestore();
    });

    it("with the default background runner, a store that throws on every write leaves no unhandled rejection", async () => {
      const store = new FakeStore();
      store.setStatus = async () => {
        throw new Error("db down");
      };
      store.markFailed = async () => {
        throw new Error("db down");
      };
      const llm = new FakeLlmClient();
      enqueueHappyPath(llm);
      // No runInBackground: this is the production runner.
      const service = new RunsService({ store: store as unknown as RunStore, config, graphRunner: makeGraphRunner(store, llm) });
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await service.createRun({ cv, jobDescription: "Backend developer" });
        // Wait until the detached work has hit the failing store, then give pending rejections a turn to surface.
        await vi.waitFor(() => expect(spy.mock.calls.some((c) => String(c[0]).includes("could not store"))).toBe(true));
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
        spy.mockRestore();
      }
    });

    it("logs the Run ID, the code, the error name and the issue count, never the message or the issues", async () => {
      const ctx = setup();
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      ctx.llm.enqueue("extract_job_profile", new ExtractionError("quotes Ada Lovelace", ["company Secret Corp not found"]));
      const id = await createExtractableRun(ctx);
      await ctx.settle();
      const calls = spy.mock.calls.map((c) => c.map(String).join(" "));
      spy.mockRestore();
      expect(calls).toEqual([`Run ${id}: pipeline failed (EXTRACTION_FAILED) ExtractionError, 1 issues`]);
    });
  });
});


describe("RunsService tailoring round", () => {
  const THREE_REQS = {
    ...JOB_PROFILE,
    requirements: [
      { text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" },
      { text: "PostgreSQL", source: "PostgreSQL", kind: "skill", importance: "must_have" },
      { text: "Docker", source: "Docker", kind: "skill", importance: "nice_to_have" },
    ],
  };
  const firstCoverage = {
    verdicts: [
      { requirementId: "req1", reason: "Built Node.js services.", evidenceIds: ["exp1.b1"], verdict: "met" },
      { requirementId: "req2", reason: "Not shown.", evidenceIds: [], verdict: "unmet" },
      { requirementId: "req3", reason: "No Docker.", evidenceIds: [], verdict: "unmet" },
    ],
  };
  const modelChange = (over: Record<string, unknown>) => ({
    op: "replace",
    targetItemId: null,
    parentId: null,
    text: null,
    orderedItemIds: null,
    evidenceIds: ["exp1.b1"],
    requirementIds: ["req2"],
    rationale: "Closer to the Requirement",
    ...over,
  });
  const addSkill = modelChange({ op: "add", parentId: "skills", text: "PostgreSQL" });
  const reword = modelChange({ targetItemId: "exp1.b1", text: "Designed and maintained Node.js services backed by PostgreSQL databases." });
  const verdict = (id: string, v: "supported" | "not_supported", reason = "r") => ({ id, reason, verdict: v });

  function tailoringSetup(judge = new FakeLlmClient()) {
    const ctx = setup(undefined, judge);
    ctx.llm.enqueue("extract_job_profile", THREE_REQS).enqueue("extract_cv", extractedCv);
    judge.enqueue("assess_coverage", firstCoverage);
    return { ...ctx, judge };
  }
  const finish = async (ctx: ReturnType<typeof tailoringSetup>) => {
    const id = await createExtractableRun(ctx);
    await ctx.settle();
    const view = await ctx.service.getRunView(id);
    if (view.status !== "awaiting_review") throw new Error(`expected awaiting_review, got ${view.status}`);
    return view;
  };

  it("keeps a round that gains points: applied Changes, new Item IDs, before and after verdicts", async () => {
    const ctx = tailoringSetup();
    ctx.judge
      .enqueue("tailor", { changes: [reword, addSkill] })
      .enqueue("claim_check", { verdicts: [verdict("r1.c1", "supported"), verdict("r1.c2", "supported")] })
      .enqueue("assess_coverage", { verdicts: [{ requirementId: "req2", reason: "Shown now.", evidenceIds: ["exp1.b1"], verdict: "met" }] })
      .enqueue("tailor", { changes: [] });
    const view = await finish(ctx);

    // Round 1 gained 43 points; round 2 found nothing more to propose.
    expect(view.exitReason).toBe("ceiling");
    expect(view.iterations).toEqual({ used: 2, max: 3 });
    expect(view.changes.map((c) => c.id)).toEqual(["r1.c1", "r1.c2"]);
    expect(view.cv.skills.map((s) => [s.id, s.text])).toEqual([["skill1", "TypeScript"], ["skill2", "Node.js"], ["skill3", "PostgreSQL"]]);
    expect(view.cv.experience[0]!.bullets[0]!.text).toBe("Designed and maintained Node.js services backed by PostgreSQL databases.");
    expect(view.score.after).toBeGreaterThan(view.score.before);
    expect(view.requirements.map((r) => [r.id, r.before, r.after.verdict])).toEqual([
      ["req1", "met", "met"],
      ["req2", "unmet", "met"],
      ["req3", "unmet", "unmet"],
    ]);
    expect(view.requirements[1]!.after.evidenceIds).toEqual(["exp1.b1"]);
  });

  it("sends tailor, claim check and both Coverage calls to the judge client, and only extraction to the main one", async () => {
    const ctx = tailoringSetup();
    ctx.judge
      .enqueue("tailor", { changes: [addSkill] })
      .enqueue("claim_check", { verdicts: [verdict("r1.c1", "supported")] })
      .enqueue("assess_coverage", { verdicts: [{ requirementId: "req2", reason: "Shown now.", evidenceIds: ["exp1.b1"], verdict: "met" }] })
      .enqueue("tailor", { changes: [] });
    await finish(ctx);
    expect(ctx.llm.calls.map((c) => c.name)).toEqual(["extract_job_profile", "extract_cv"]);
    expect(ctx.judge.calls.map((c) => c.name)).toEqual(["assess_coverage", "tailor", "claim_check", "assess_coverage", "tailor"]);
  });

  it("re-judges only the Requirements the valid Changes list", async () => {
    const ctx = tailoringSetup();
    ctx.judge
      .enqueue("tailor", { changes: [addSkill] })
      .enqueue("claim_check", { verdicts: [verdict("r1.c1", "supported")] })
      .enqueue("assess_coverage", { verdicts: [{ requirementId: "req2", reason: "Shown now.", evidenceIds: ["exp1.b1"], verdict: "met" }] })
      .enqueue("tailor", { changes: [] });
    await finish(ctx);
    const rejudge = JSON.stringify(ctx.judge.calls[3]!.messages);
    expect(rejudge).toContain("req2");
    expect(rejudge).not.toContain("req1");
    expect(rejudge).not.toContain("req3");
    expect(rejudge).toContain("PostgreSQL");
    expect(rejudge).not.toContain("Docker");
  });

  it("ends with ceiling and no Changes when the claim check rejects every Change, without a re-judge", async () => {
    const ctx = tailoringSetup();
    ctx.judge
      .enqueue("tailor", { changes: [reword, addSkill] })
      .enqueue("claim_check", { verdicts: [verdict("r1.c1", "not_supported"), verdict("r1.c2", "not_supported")] });
    const view = await finish(ctx);
    expect(view.exitReason).toBe("ceiling");
    expect(view.changes).toEqual([]);
    expect(view.score.after).toBe(view.score.before);
    expect(view.cv.skills).toHaveLength(2);
    expect(view.iterations.used).toBe(1);
    expect(ctx.judge.calls.map((c) => c.name)).toEqual(["assess_coverage", "tailor", "claim_check"]);
  });

  it("never sends a stage-1 rejection to the claim check", async () => {
    const ctx = tailoringSetup();
    const unknownTarget = modelChange({ targetItemId: "exp9.b9", text: "Something" });
    ctx.judge.enqueue("tailor", { changes: [unknownTarget, addSkill] }).enqueue("claim_check", { verdicts: [verdict("r1.c2", "not_supported")] });
    const view = await finish(ctx);
    const prompt = JSON.stringify(ctx.judge.calls[2]!.messages);
    expect(prompt).toContain("r1.c2");
    expect(prompt).not.toContain("r1.c1");
    expect(view.exitReason).toBe("ceiling");
  });

  it("skips claim check and tailoring work entirely when every Change fails stage 1", async () => {
    const ctx = tailoringSetup();
    ctx.judge.enqueue("tailor", { changes: [modelChange({ targetItemId: "exp9.b9", text: "Something" })] });
    const view = await finish(ctx);
    expect(view.exitReason).toBe("ceiling");
    expect(ctx.judge.calls.map((c) => c.name)).toEqual(["assess_coverage", "tailor"]);
  });

  it("does not tailor at all when every Requirement is already met", async () => {
    const judge = new FakeLlmClient().enqueue("assess_coverage", coverageAnswer);
    const ctx = setup(undefined, judge);
    ctx.llm.enqueue("extract_job_profile", JOB_PROFILE).enqueue("extract_cv", extractedCv);
    const id = await createExtractableRun(ctx);
    await ctx.settle();
    const view = await ctx.service.getRunView(id);
    if (view.status !== "awaiting_review") throw new Error("expected awaiting_review");
    expect(view.exitReason).toBe("target_reached");
    expect(view.iterations.used).toBe(0);
    expect(judge.calls.map((c) => c.name)).toEqual(["assess_coverage"]);
  });

  it("stops at awaiting_review with exit reason error, keeping nothing, when the round fails", async () => {
    const ctx = tailoringSetup();
    ctx.judge.enqueue("tailor", new LlmUnavailableError("down"), new LlmUnavailableError("down"));
    const view = await finish(ctx);
    expect(view.exitReason).toBe("error");
    expect(view.changes).toEqual([]);
    expect(view.score.after).toBe(view.score.before);
  });

  it("writes the tailoring status once, before the round's first call, and shows a tailoring view meanwhile", async () => {
    let seen: { status: string; used?: number } | undefined;
    let service: RunsService | undefined;
    let runId = "";
    const ctx = tailoringSetup();
    service = ctx.service;
    const structured = ctx.judge.structured.bind(ctx.judge) as typeof ctx.judge.structured;
    ctx.judge.structured = (async (...args: Parameters<typeof structured>) => {
      if (args[2].name === "tailor") {
        const view = await service!.getRunView(runId);
        seen = { status: view.status, used: view.status === "tailoring" ? view.iterations.used : undefined };
      }
      return structured(...args);
    }) as typeof ctx.judge.structured;
    ctx.judge.enqueue("tailor", { changes: [] });
    runId = await createExtractableRun(ctx);
    await ctx.settle();
    // `iterations.used` counts rounds started, so it is already 1 while round 1 runs.
    expect(seen).toEqual({ status: "tailoring", used: 1 });
    expect(ctx.store.statusLog).toEqual(["extracting", "tailoring", "awaiting_review"]);
  });

  describe("the loop", () => {
    // Weights: req1 3, req2 3, req3 1 (total 7). Scores below are the unrounded Match Score.
    const cov = (...v: ("met" | "partially_met" | "unmet")[]) => ({
      verdicts: v.map((verdict, i) => ({ requirementId: `req${i + 1}`, reason: `reason ${i + 1}`, evidenceIds: verdict === "unmet" ? [] : ["exp1.b1"], verdict })),
    });
    const rejudged = (id: string, v: "met" | "partially_met" | "unmet") => ({ verdicts: [{ requirementId: id, reason: `now ${v}`, evidenceIds: ["exp1.b1"], verdict: v }] });
    const addSkillFor = (text: string, req: string) => modelChange({ op: "add", parentId: "skills", text, requirementIds: [req] });
    const replaceFor = (target: string, text: string, req: string) => modelChange({ targetItemId: target, text, requirementIds: [req] });

    /** Starts from a custom first Coverage (and no `firstCoverage` from the shared setup). */
    function loopSetup(first: ReturnType<typeof cov>) {
      const judge = new FakeLlmClient();
      const ctx = setup(undefined, judge);
      ctx.llm.enqueue("extract_job_profile", THREE_REQS).enqueue("extract_cv", extractedCv);
      judge.enqueue("assess_coverage", first);
      return { ...ctx, judge };
    }
    /** One round: the tailor answer, the claim verdicts for r<round>.c<n>, and the re-judge answer. */
    function round(judge: FakeLlmClient, n: number, changes: unknown[], rejudge: unknown, claim: ("supported" | "not_supported")[] = changes.map(() => "supported")) {
      judge.enqueue("tailor", { changes }).enqueue("claim_check", { verdicts: claim.map((c, i) => verdict(`r${n}.c${i + 1}`, c, `claim reason ${n}.${i + 1}`)) });
      if (rejudge !== null) judge.enqueue("assess_coverage", rejudge);
    }

    it("runs a second round and stops with target_reached when the score reaches 90", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet")); // 42.9
      round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met")); // 64.3
      round(ctx.judge, 2, [replaceFor("exp1.b1", "Designed Node.js services and PostgreSQL databases.", "req2"), addSkillFor("Docker", "req3")], {
        verdicts: [rejudged("req2", "met").verdicts[0], rejudged("req3", "met").verdicts[0]],
      }); // 100
      const view = await finish(ctx);
      expect(view.exitReason).toBe("target_reached");
      expect(view.iterations).toEqual({ used: 2, max: 3 });
      expect(view.score).toEqual({ before: 43, after: 100 });
      expect(view.changes.map((c) => c.id)).toEqual(["r1.c1", "r2.c1", "r2.c2"]);
    });

    it("stops with ceiling in round 2 when nothing valid is proposed, keeping round 1", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet"));
      round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met"));
      round(ctx.judge, 2, [], null);
      const view = await finish(ctx);
      expect(view.exitReason).toBe("ceiling");
      expect(view.iterations.used).toBe(2);
      expect(view.changes.map((c) => c.id)).toEqual(["r1.c1"]);
      expect(view.score.after).toBe(64);
    });

    it("stops with plateau and keeps a round that gained too little", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet")); // 42.9
      round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met")); // 64.3
      round(ctx.judge, 2, [addSkillFor("Docker", "req3")], rejudged("req3", "unmet")); // 64.3: gain 0
      const view = await finish(ctx);
      expect(view.exitReason).toBe("plateau");
      expect(view.changes.map((c) => c.id)).toEqual(["r1.c1", "r2.c1"]);
    });

    it("undoes a lower-scoring round: plateau, and round 1's result stays in place", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet"));
      round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met")); // 64.3
      round(ctx.judge, 2, [replaceFor("exp1.b1", "Worked with services.", "req1")], rejudged("req1", "unmet")); // 21.4
      const view = await finish(ctx);
      expect(view.exitReason).toBe("plateau");
      expect(view.iterations.used).toBe(2);
      expect(view.score.after).toBe(64);
      expect(view.changes.map((c) => c.id)).toEqual(["r1.c1"]);
      expect(view.cv.experience[0]!.bullets[0]!.text).toBe(extractedCv.experience[0]!.bullets[0]);
      expect(view.requirements.map((r) => r.after.verdict)).toEqual(["met", "partially_met", "unmet"]);
    });

    it("stops with max_iterations after three rounds that each gain", async () => {
      const ctx = loopSetup(cov("partially_met", "unmet", "unmet")); // 21.4
      round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met")); // 42.9
      round(ctx.judge, 2, [replaceFor("skill3", "PostgreSQL databases", "req2")], rejudged("req2", "met")); // 64.3
      round(ctx.judge, 3, [replaceFor("exp1.b1", "Designed and maintained Node.js services backed by PostgreSQL.", "req1")], rejudged("req1", "met")); // 85.7
      const view = await finish(ctx);
      expect(view.exitReason).toBe("max_iterations");
      expect(view.iterations).toEqual({ used: 3, max: 3 });
      expect(ctx.judge.calls.filter((c) => c.name === "tailor")).toHaveLength(3);
    });

    it("keeps one Change per Item across rounds: ID and original text stay, Requirements merge, an added Item can be reworded", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet"));
      round(ctx.judge, 1, [replaceFor("exp1.b1", "Built Node.js services backed by PostgreSQL.", "req2"), addSkillFor("Postgres", "req2")], rejudged("req2", "partially_met")); // 64.3
      round(
        ctx.judge,
        2,
        [replaceFor("exp1.b1", "Designed and maintained Node.js services backed by PostgreSQL databases.", "req3"), replaceFor("skill3", "PostgreSQL", "req3")],
        rejudged("req3", "partially_met"),
      ); // 71.4
      const view = await finish(ctx);
      expect(view.changes.map((c) => [c.id, c.op])).toEqual([["r1.c1", "replace"], ["r1.c2", "add"]]);
      const first = view.changes[0]!;
      if (first.op !== "replace") throw new Error("expected a replace");
      expect(first.before).toBe(extractedCv.experience[0]!.bullets[0]);
      expect(first.after).toBe("Designed and maintained Node.js services backed by PostgreSQL databases.");
      expect(first.requirementIds).toEqual(["req2", "req3"]);
      const added = view.changes[1]!;
      if (added.op !== "add") throw new Error("expected an add");
      expect(added.after).toBe("PostgreSQL");
      expect(view.cv.skills.map((s) => s.text)).toEqual(["TypeScript", "Node.js", "PostgreSQL"]);
    });

    it("tells round 2's tailor about round 1's rejection and its reason", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet"));
      round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2"), addSkillFor("Kubernetes", "req3")], rejudged("req2", "partially_met"), ["supported", "not_supported"]);
      round(ctx.judge, 2, [], null);
      await finish(ctx);
      const tailorCalls = ctx.judge.calls.filter((c) => c.name === "tailor");
      const userText = (call: { messages: { role: string; content: string }[] }) => call.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      expect(userText(tailorCalls[0]!)).not.toContain("Rejected earlier");
      const second = userText(tailorCalls[1]!);
      expect(second).toContain("Rejected earlier");
      expect(second).toContain("claim reason 1.2");
      expect(second).toContain("Kubernetes");
    });

    it("counts a round as used from the moment it starts", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet"));
      let seen: number | undefined;
      let runId = "";
      const structured = ctx.judge.structured.bind(ctx.judge) as typeof ctx.judge.structured;
      ctx.judge.structured = (async (...args: Parameters<typeof structured>) => {
        if (args[2].name === "tailor") {
          const view = await ctx.service.getRunView(runId);
          if (view.status === "tailoring") seen = view.iterations.used;
        }
        return structured(...args);
      }) as typeof ctx.judge.structured;
      ctx.judge.enqueue("tailor", { changes: [] });
      runId = await createExtractableRun(ctx);
      await ctx.settle();
      expect(seen).toBe(1);
    });

    it("shows the rounded first score and the latest kept score (null before any round is kept) while tailoring", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet"));
      const seen: { before: number; after: number | null }[] = [];
      let runId = "";
      const structured = ctx.judge.structured.bind(ctx.judge) as typeof ctx.judge.structured;
      ctx.judge.structured = (async (...args: Parameters<typeof structured>) => {
        if (args[2].name === "tailor") {
          const view = await ctx.service.getRunView(runId);
          if (view.status === "tailoring") seen.push(view.score);
        }
        return structured(...args);
      }) as typeof ctx.judge.structured;
      round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met"));
      round(ctx.judge, 2, [], null);
      runId = await createExtractableRun(ctx);
      await ctx.settle();
      expect(seen).toEqual([{ before: 43, after: null }, { before: 43, after: 64 }]);
    });

    describe("failures", () => {
      const errorLogs = () => vi.spyOn(console, "error").mockImplementation(() => undefined);

      it("a tailor failure in round 2 keeps round 1's result and exits error", async () => {
        const ctx = loopSetup(cov("met", "unmet", "unmet"));
        round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met"));
        ctx.judge.enqueue("tailor", new LlmUnavailableError("down"));
        const view = await finish(ctx);
        expect(view.exitReason).toBe("error");
        expect(view.changes.map((c) => c.id)).toEqual(["r1.c1"]);
        expect(view.score.after).toBe(64);
        expect(view.iterations.used).toBe(2);
      });

      it("a claim-check failure after its retry in round 2 keeps round 1's result", async () => {
        const ctx = loopSetup(cov("met", "unmet", "unmet"));
        round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met"));
        ctx.judge.enqueue("tailor", { changes: [addSkillFor("Docker", "req3")] }).enqueue("claim_check", new LlmSchemaError("bad", ["x"]), new LlmSchemaError("bad", ["x"]));
        const view = await finish(ctx);
        expect(view.exitReason).toBe("error");
        expect(view.changes.map((c) => c.id)).toEqual(["r1.c1"]);
        expect(view.cv.skills.map((s) => s.text)).toEqual(["TypeScript", "Node.js", "PostgreSQL"]);
      });

      it("a re-judge failure in round 2 keeps round 1's result", async () => {
        const ctx = loopSetup(cov("met", "unmet", "unmet"));
        round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met"));
        round(ctx.judge, 2, [addSkillFor("Docker", "req3")], null);
        ctx.judge.enqueue("assess_coverage", new LlmSchemaError("bad", ["x"]), new LlmSchemaError("bad", ["x"]));
        const view = await finish(ctx);
        expect(view.exitReason).toBe("error");
        expect(view.changes.map((c) => c.id)).toEqual(["r1.c1"]);
        expect(view.score.after).toBe(64);
      });

      it("a failure in round 1 gives zero Changes and before = after", async () => {
        const ctx = loopSetup(cov("met", "unmet", "unmet"));
        round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], null);
        ctx.judge.enqueue("assess_coverage", new LlmUnavailableError("down"));
        const view = await finish(ctx);
        expect(view.exitReason).toBe("error");
        expect(view.changes).toEqual([]);
        expect(view.score.after).toBe(view.score.before);
        expect(view.iterations.used).toBe(1);
      });

      it("logs the error name and issue count only, never the message or the issues", async () => {
        const log = errorLogs();
        const ctx = loopSetup(cov("met", "unmet", "unmet"));
        ctx.judge.enqueue("tailor", new LlmSchemaError("secret message", ["secret issue"]), new LlmSchemaError("secret message", ["secret issue"]));
        await finish(ctx);
        const logged = log.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
        log.mockRestore();
        expect(logged).toContain("round 1 failed");
        expect(logged).toContain("TailorError");
        expect(logged).toContain("1 issues");
        expect(logged).not.toContain("secret");
      });
    });
  });
});
