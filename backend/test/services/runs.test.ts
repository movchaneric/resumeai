import { InProcessRunEvents } from "@/utils/runEvents.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunErrorCode, RunId, RunStatus } from "@resume-ai/shared";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/utils/config.js";
import { ApiError } from "@/utils/errors.js";
import type { NewRun, RunStore, StoredRun } from "@/stores/runs.js";
import { RunsService, type GraphRunner, type RunSnapshot } from "@/services/runs.js";
import { CoverageError } from "@/scoring/errors.js";
import { ExtractionError, NoRequirementsError } from "@/extraction/errors.js";
import { LlmSchemaError, LlmUnavailableError } from "@/llm/llmClient.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { makeGraphRunner, skipQuestions } from "../fakes/runGraph.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";
import { COVERAGE_VOTES } from "@/scoring/assessCoverage.js";

/** One Coverage judgement is COVERAGE_VOTES parallel calls. */
const COVERAGE = Array.from({ length: COVERAGE_VOTES }, () => "assess_coverage");

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
  const graphRunner = skipQuestions(makeGraphRunner(store, llm, judgeLlm));
  // Tasks are held back until `settle`, so a test can look at the Run before the pipeline starts.
  const tasks: (() => Promise<void>)[] = [];
  const runInBackground = (task: () => Promise<void>) => {
    tasks.push(task);
  };
  const service = new RunsService({ store: store as unknown as RunStore, config, graphRunner, events: new InProcessRunEvents(), now, runInBackground });
  /** Runs every scheduled task and waits for it. A task that rejected fails the test. */
  const settle = async () => {
    await Promise.all(tasks.map((task) => task()));
  };
  return { store, llm, tasks, settle, service };
}

/** Queues a full successful pipeline: extraction, then the first Coverage. */
function enqueueHappyPath(llm: FakeLlmClient) {
  llm.enqueue("extract_job_profile", JOB_PROFILE).enqueue("extract_cv", extractedCv).enqueueVoted("assess_coverage", COVERAGE_ANSWER);
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

    it("sends the Job Profile extraction and Coverage to judgeLlm and the CV extraction to llm", async () => {
      const judgeLlm = new FakeLlmClient().enqueue("extract_job_profile", JOB_PROFILE).enqueueVoted("assess_coverage", COVERAGE_ANSWER);
      const ctx = setup(undefined, judgeLlm);
      ctx.llm.enqueue("extract_cv", extractedCv);
      await createExtractableRun(ctx);
      await ctx.settle();

      expect(ctx.llm.calls.map((c) => c.name)).toEqual(["extract_cv"]);
      expect(judgeLlm.calls.map((c) => c.name)).toEqual(["extract_job_profile", ...COVERAGE]);
    });

    it("uses llm for Coverage when no judge client is given", async () => {
      const ctx = setup();
      enqueueHappyPath(ctx.llm);
      await createExtractableRun(ctx);
      await ctx.settle();
      expect(ctx.llm.calls.map((c) => c.name)).toEqual(["extract_job_profile", "extract_cv", ...COVERAGE]);
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
        .enqueueVoted("assess_coverage", {
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
        .enqueueVoted("assess_coverage", new LlmSchemaError("bad", ["a: wrong"]), new LlmSchemaError("bad", ["b: wrong"]));
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

    it("logs the status and code of an LlmUnavailableError, never its message", async () => {
      const ctx = setup();
      ctx.llm
        .enqueue("extract_job_profile", JOB_PROFILE)
        .enqueue("extract_cv", extractedCv)
        .enqueueVoted("assess_coverage", new LlmUnavailableError("quota text that could quote a CV", { status: 429, code: "insufficient_quota" }));
      const id = await createExtractableRun(ctx);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      await ctx.settle();
      const logged = spy.mock.calls.map((c) => c.map(String).join(" "));
      spy.mockRestore();
      expect(logged).toEqual([`Run ${id}: pipeline failed (INTERNAL) LlmUnavailableError status=429 code=insufficient_quota`]);
      expect(logged.join(" ")).not.toContain("quota text");
    });

    it("turns LlmUnavailableError during Coverage into INTERNAL", async () => {
      const ctx = setup();
      ctx.llm
        .enqueue("extract_job_profile", JOB_PROFILE)
        .enqueue("extract_cv", extractedCv)
        .enqueueVoted("assess_coverage", new LlmUnavailableError("model down"));
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
      const service = new RunsService({ store: store as unknown as RunStore, config, graphRunner: skipQuestions(makeGraphRunner(store, llm)), events: new InProcessRunEvents() });
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
    ctx.llm.enqueue("extract_cv", extractedCv);
    judge.enqueue("extract_job_profile", THREE_REQS).enqueueVoted("assess_coverage", firstCoverage);
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
      .enqueueVoted("assess_coverage", { verdicts: [{ requirementId: "req2", reason: "Shown now.", evidenceIds: ["exp1.b1"], verdict: "met" }] })
      .enqueue("tailor", { changes: [] }, { changes: [] });
    const view = await finish(ctx);

    // Round 1 gained 43 points; rounds 2 and 3 found nothing more to propose.
    expect(view.exitReason).toBe("ceiling");
    expect(view.iterations).toEqual({ used: 3, max: 3 });
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
      .enqueueVoted("assess_coverage", { verdicts: [{ requirementId: "req2", reason: "Shown now.", evidenceIds: ["exp1.b1"], verdict: "met" }] })
      .enqueue("tailor", { changes: [] }, { changes: [] });
    await finish(ctx);
    expect(ctx.llm.calls.map((c) => c.name)).toEqual(["extract_cv"]);
    expect(ctx.judge.calls.map((c) => c.name)).toEqual(["extract_job_profile", ...COVERAGE, "tailor", "claim_check", ...COVERAGE, "tailor", "tailor"]);
  });

  it("re-judges only the Requirements the valid Changes list", async () => {
    const ctx = tailoringSetup();
    ctx.judge
      .enqueue("tailor", { changes: [addSkill] })
      .enqueue("claim_check", { verdicts: [verdict("r1.c1", "supported")] })
      .enqueueVoted("assess_coverage", { verdicts: [{ requirementId: "req2", reason: "Shown now.", evidenceIds: ["exp1.b1"], verdict: "met" }] })
      .enqueue("tailor", { changes: [] }, { changes: [] });
    await finish(ctx);
    const rejudge = JSON.stringify(ctx.judge.calls.filter((c) => c.name === "assess_coverage")[COVERAGE_VOTES]!.messages);
    expect(rejudge).toContain("req2");
    expect(rejudge).not.toContain("req1");
    expect(rejudge).not.toContain("req3");
    expect(rejudge).toContain("PostgreSQL");
    expect(rejudge).not.toContain("Docker");
  });

  it("ends with ceiling and no Changes when the claim check rejects every Change and round 2 is empty too, without a re-judge", async () => {
    const ctx = tailoringSetup();
    ctx.judge
      .enqueue("tailor", { changes: [reword, addSkill] })
      .enqueue("claim_check", { verdicts: [verdict("r1.c1", "not_supported"), verdict("r1.c2", "not_supported")] })
      .enqueue("tailor", { changes: [] });
    const view = await finish(ctx);
    expect(view.exitReason).toBe("ceiling");
    expect(view.changes).toEqual([]);
    expect(view.score.after).toBe(view.score.before);
    expect(view.cv.skills).toHaveLength(2);
    expect(view.iterations.used).toBe(2);
    expect(ctx.judge.calls.map((c) => c.name)).toEqual(["extract_job_profile", ...COVERAGE, "tailor", "claim_check", "tailor"]);
  });

  it("never sends a stage-1 rejection to the claim check", async () => {
    const ctx = tailoringSetup();
    const unknownTarget = modelChange({ targetItemId: "exp9.b9", text: "Something" });
    ctx.judge.enqueue("tailor", { changes: [unknownTarget, addSkill] }).enqueue("claim_check", { verdicts: [verdict("r1.c2", "not_supported")] }).enqueue("tailor", { changes: [] });
    const view = await finish(ctx);
    const prompt = JSON.stringify(ctx.judge.calls.find((c) => c.name === "claim_check")!.messages);
    expect(prompt).toContain("r1.c2");
    expect(prompt).not.toContain("r1.c1");
    expect(view.exitReason).toBe("ceiling");
  });

  it("skips claim check and tailoring work entirely when every Change fails stage 1", async () => {
    const ctx = tailoringSetup();
    const bad = { changes: [modelChange({ targetItemId: "exp9.b9", text: "Something" })] };
    ctx.judge.enqueue("tailor", bad, bad);
    const view = await finish(ctx);
    expect(view.exitReason).toBe("ceiling");
    expect(ctx.judge.calls.map((c) => c.name)).toEqual(["extract_job_profile", ...COVERAGE, "tailor", "tailor"]);
  });

  it("does not tailor at all when every Requirement is already met", async () => {
    const judge = new FakeLlmClient().enqueue("extract_job_profile", JOB_PROFILE).enqueueVoted("assess_coverage", coverageAnswer);
    const ctx = setup(undefined, judge);
    ctx.llm.enqueue("extract_cv", extractedCv);
    const id = await createExtractableRun(ctx);
    await ctx.settle();
    const view = await ctx.service.getRunView(id);
    if (view.status !== "awaiting_review") throw new Error("expected awaiting_review");
    expect(view.exitReason).toBe("target_reached");
    expect(view.iterations.used).toBe(0);
    expect(judge.calls.map((c) => c.name)).toEqual(["extract_job_profile", ...COVERAGE]);
  });

  it("stops at awaiting_review with exit reason error, keeping nothing, when the round fails", async () => {
    const ctx = tailoringSetup();
    ctx.judge.enqueue("tailor", new LlmUnavailableError("down"), new LlmUnavailableError("down"));
    const view = await finish(ctx);
    expect(view.exitReason).toBe("error");
    expect(view.changes).toEqual([]);
    expect(view.score.after).toBe(view.score.before);
  });

  it("ends at awaiting_review with exit reason error when the tailoring status write fails, instead of failing the Run", async () => {
    const ctx = tailoringSetup();
    const write = ctx.store.setStatus.bind(ctx.store);
    ctx.store.setStatus = async (id, status) => {
      if (status === "tailoring") throw new Error("db down");
      return write(id, status);
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const view = await finish(ctx);
      expect(view.exitReason).toBe("error");
      expect(view.changes).toEqual([]);
    } finally {
      spy.mockRestore();
    }
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
        seen ??= { status: view.status, used: view.status === "tailoring" ? view.iterations.used : undefined };
      }
      return structured(...args);
    }) as typeof ctx.judge.structured;
    ctx.judge.enqueue("tailor", { changes: [] }, { changes: [] });
    runId = await createExtractableRun(ctx);
    await ctx.settle();
    // `iterations.used` counts rounds started, so it is already 1 while round 1 runs.
    expect(seen).toEqual({ status: "tailoring", used: 1 });
    expect(ctx.store.statusLog).toEqual(["extracting", "awaiting_answers", "tailoring", "awaiting_review"]);
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
      ctx.llm.enqueue("extract_cv", extractedCv);
      judge.enqueue("extract_job_profile", THREE_REQS).enqueueVoted("assess_coverage", first);
      return { ...ctx, judge };
    }
    /** One round: the tailor answer, the claim verdicts for r<round>.c<n>, and the re-judge answer. */
    function round(judge: FakeLlmClient, n: number, changes: unknown[], rejudge: unknown, claim: ("supported" | "not_supported")[] = changes.map(() => "supported")) {
      judge.enqueue("tailor", { changes }).enqueue("claim_check", { verdicts: claim.map((c, i) => verdict(`r${n}.c${i + 1}`, c, `claim reason ${n}.${i + 1}`)) });
      if (rejudge !== null) judge.enqueueVoted("assess_coverage", rejudge);
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

    it("stops with ceiling in round 3 after two empty rounds, keeping round 1", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet"));
      round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met"));
      round(ctx.judge, 2, [], null);
      round(ctx.judge, 3, [], null);
      const view = await finish(ctx);
      expect(view.exitReason).toBe("ceiling");
      expect(view.iterations.used).toBe(3);
      expect(view.changes.map((c) => c.id)).toEqual(["r1.c1"]);
      expect(view.score.after).toBe(64);
    });

    it("gives an empty round a second chance: round 1 all rejected, round 2 gains and is kept, and its tailor saw the rejection reasons", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet"));
      round(ctx.judge, 1, [addSkillFor("Kubernetes", "req2")], null, ["not_supported"]);
      round(ctx.judge, 2, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met"));
      round(ctx.judge, 3, [], null);
      const view = await finish(ctx);
      expect(view.changes.map((c) => c.id)).toEqual(["r2.c1"]);
      expect(view.score.after).toBe(64);
      const tailorCalls = ctx.judge.calls.filter((c) => c.name === "tailor");
      const second = tailorCalls[1]!.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
      expect(second).toContain("Rejected earlier");
      expect(second).toContain("claim reason 1.1");
      expect(second).toContain("Kubernetes");
    });

    it("stops with ceiling after two empty rounds in a row, with two rounds used and nothing kept", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet"));
      round(ctx.judge, 1, [addSkillFor("Kubernetes", "req2")], null, ["not_supported"]);
      round(ctx.judge, 2, [], null);
      const view = await finish(ctx);
      expect(view.exitReason).toBe("ceiling");
      expect(view.iterations.used).toBe(2);
      expect(view.changes).toEqual([]);
      expect(view.score.after).toBe(view.score.before);
    });

    it("stops with max_iterations when round 3 is empty after a valid round 2", async () => {
      const ctx = loopSetup(cov("met", "unmet", "unmet"));
      round(ctx.judge, 1, [], null);
      round(ctx.judge, 2, [addSkillFor("PostgreSQL", "req2")], rejudged("req2", "partially_met"));
      round(ctx.judge, 3, [], null);
      const view = await finish(ctx);
      expect(view.exitReason).toBe("max_iterations");
      expect(view.iterations.used).toBe(3);
      expect(view.changes.map((c) => c.id)).toEqual(["r2.c1"]);
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
          if (view.status === "tailoring") seen ??= view.iterations.used;
        }
        return structured(...args);
      }) as typeof ctx.judge.structured;
      ctx.judge.enqueue("tailor", { changes: [] }, { changes: [] });
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
      round(ctx.judge, 3, [], null);
      runId = await createExtractableRun(ctx);
      await ctx.settle();
      expect(seen).toEqual([{ before: 43, after: null }, { before: 43, after: 64 }, { before: 43, after: 64 }]);
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
        ctx.judge.enqueueVoted("assess_coverage", new LlmSchemaError("bad", ["x"]), new LlmSchemaError("bad", ["x"]));
        const view = await finish(ctx);
        expect(view.exitReason).toBe("error");
        expect(view.changes.map((c) => c.id)).toEqual(["r1.c1"]);
        expect(view.score.after).toBe(64);
      });

      it("a failure in round 1 gives zero Changes and before = after", async () => {
        const ctx = loopSetup(cov("met", "unmet", "unmet"));
        round(ctx.judge, 1, [addSkillFor("PostgreSQL", "req2")], null);
        ctx.judge.enqueueVoted("assess_coverage", new LlmUnavailableError("down"));
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

describe("RunsService awaiting answers", () => {
  it("shows the Questions while the Run is paused, then the review summary with its User Evidence and Confirmed Gaps once answered", async () => {
    const store = new FakeStore();
    const llm = new FakeLlmClient();
    const judge = new FakeLlmClient()
      .enqueue("extract_job_profile", {
        ...JOB_PROFILE,
        requirements: [
          { text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" },
          { text: "Kubernetes", source: "Kubernetes", kind: "skill", importance: "must_have" },
          { text: "Terraform", source: "Terraform", kind: "skill", importance: "must_have" },
        ],
      })
      .enqueueVoted("assess_coverage", {
        verdicts: [
          { requirementId: "req1", reason: "r", evidenceIds: ["exp1.b1"], verdict: "met" },
          { requirementId: "req2", reason: "r", evidenceIds: [], verdict: "unmet" },
          { requirementId: "req3", reason: "r", evidenceIds: ["exp1.b1"], verdict: "partially_met" },
        ],
      })
      .enqueue("tailor", { changes: [] }, { changes: [] });
    llm.enqueue("extract_cv", extractedCv);
    const graphRunner = makeGraphRunner(store, llm, judge);
    const tasks: (() => Promise<void>)[] = [];
    const service = new RunsService({ store: store as unknown as RunStore, config, graphRunner, events: new InProcessRunEvents(), runInBackground: (t) => void tasks.push(t) });
    const id = await service.createRun({ cv, jobDescription: "Backend developer" });
    await Promise.all(tasks.map((t) => t()));

    const paused = await service.getRunView(id);
    if (paused.status !== "awaiting_answers") throw new Error(`unexpected status ${paused.status}`);
    expect(paused.questions.map((q) => [q.id, q.requirementId, q.text])).toEqual([
      ["q1", "req2", "The job asks for: Kubernetes. Have you done this? Describe where and how."],
      ["q2", "req3", "The job asks for: Terraform. Have you done this? Describe where and how."],
    ]);
    expect(stepStates(paused)).toEqual(["parse:done", "extract:done", "coverage:done", "questions:running"]);

    await graphRunner.answer(id as RunId, [
      { kind: "has_experience", questionId: "q1" as never, text: "Ran clusters at Acme." },
      { kind: "no_experience", questionId: "q2" as never },
    ]);
    const review = await service.getRunView(id);
    if (review.status !== "awaiting_review") throw new Error(`unexpected status ${review.status}`);
    expect(review.userEvidence.map((u) => [u.id, u.requirementId, u.text])).toEqual([["ue1", "req2", "Ran clusters at Acme."]]);
    expect(review.requirements.map((r) => r.confirmedGap)).toEqual([false, false, true]);
  });
});

describe("RunsService.submitAnswers", () => {
  const runId = "22222222-2222-4222-8222-222222222222" as RunId;
  const questions = [
    { id: "q1", requirementId: "req2", text: "Have you done this?" },
    { id: "q2", requirementId: "req3", text: "Have you done that?" },
  ];
  const snapshot = {
    jobProfile: null, cv: null, coverageBefore: null, coverage: null, changes: [], scoreBefore: null, scoreAfter: null,
    pausedAt: "answers", rejections: [], questions, userEvidence: [], confirmedGaps: [], rounds: 0, exitReason: null,
  } as unknown as RunSnapshot;

  /** A store (extended with the atomic claim) holding a Run in `status`, and a runner whose `answer` is a spy. */
  function answerSetup(status: RunStatus = "awaiting_answers", now = () => new Date("2026-10-01T00:00:00Z")) {
    const store = new FakeStore() as FakeStore & { claimStatus(id: RunId, from: RunStatus, to: RunStatus): Promise<boolean> };
    store.claimStatus = async (id, from, to) => {
      if (store.rows.get(id)?.status !== from) return false;
      await store.setStatus(id, to);
      return true;
    };
    store.rows.set(runId, { id: runId, status, createdAt: now(), expiresAt: new Date(now().getTime() + 1000), exportPath: null, error: null });
    const answer = vi.fn<GraphRunner["answer"]>(async () => snapshot);
    const graphRunner: GraphRunner = { start: async () => snapshot, answer, recover: async () => snapshot, read: async () => snapshot, deleteThread: async () => {} };
    const tasks: (() => Promise<void>)[] = [];
    const service = new RunsService({ store: store as unknown as RunStore, config, graphRunner, events: new InProcessRunEvents(), now, runInBackground: (t) => void tasks.push(t) });
    return { store, answer, tasks, service };
  }
  const has = (questionId: string, text: string) => ({ kind: "has_experience", questionId, text });
  const rejection = async (promise: Promise<unknown>) => (await promise.then(() => null, (e) => e)) as ApiError;

  it("resumes the graph in the background with trimmed Answers and moves the Run out of awaiting_answers", async () => {
    const { service, store, answer, tasks } = answerSetup();
    await service.submitAnswers(runId, { answers: [has("q2", "  Ran a cluster.  "), { kind: "no_experience", questionId: "q1" }] });
    expect(store.rows.get(runId)?.status).toBe("tailoring");
    expect(answer).not.toHaveBeenCalled();
    await tasks[0]!();
    expect(answer).toHaveBeenCalledExactlyOnceWith(runId, [has("q2", "Ran a cluster."), { kind: "no_experience", questionId: "q1" }]);
  });

  it("accepts an empty list and a text of exactly 1,000 characters", async () => {
    await answerSetup().service.submitAnswers(runId, { answers: [] });
    await answerSetup().service.submitAnswers(runId, { answers: [has("q1", " " + "x".repeat(1000) + " ")] });
  });

  it.each([
    ["no body", undefined],
    ["a body that is not an object", "q1"],
    ["answers that is not a list", { answers: "q1" }],
    ["an Answer of an unknown kind", { answers: [{ kind: "maybe", questionId: "q1" }] }],
    ["an Answer without a Question ID", { answers: [{ kind: "no_experience" }] }],
    ["a text that is only whitespace", { answers: [has("q1", "   \n ")] }],
    ["a text over 1,000 characters", { answers: [has("q1", "x".repeat(1001))] }],
    ["a Question that does not exist", { answers: [has("q9", "text")] }],
    ["a Question answered twice", { answers: [has("q1", "a"), { kind: "no_experience", questionId: "q1" }] }],
  ])("rejects %s as INVALID_ANSWERS without resuming", async (_name, body) => {
    const { service, answer, tasks, store } = answerSetup();
    const error = await rejection(service.submitAnswers(runId, body));
    expect(error.code).toBe("INVALID_ANSWERS");
    expect(error.status).toBe(400);
    expect(tasks).toHaveLength(0);
    expect(answer).not.toHaveBeenCalled();
    expect(store.rows.get(runId)?.status).toBe("awaiting_answers");
  });

  it("answers 404 for a malformed, unknown or expired Run", async () => {
    let now = new Date("2026-10-01T00:00:00Z");
    const { service } = answerSetup("awaiting_answers", () => now);
    expect((await rejection(service.submitAnswers("nope", { answers: [] }))).code).toBe("RUN_NOT_FOUND");
    expect((await rejection(service.submitAnswers("33333333-3333-4333-8333-333333333333", { answers: [] }))).code).toBe("RUN_NOT_FOUND");
    now = new Date(now.getTime() + 1000);
    expect((await rejection(service.submitAnswers(runId, { answers: [] }))).code).toBe("RUN_NOT_FOUND");
  });

  it.each<RunStatus>(["extracting", "tailoring", "awaiting_review", "failed"])("answers 409 when the Run is %s", async (status) => {
    const { service, tasks } = answerSetup(status);
    const error = await rejection(service.submitAnswers(runId, { answers: [] }));
    expect(error.code).toBe("RUN_NOT_AWAITING_ANSWERS");
    expect(error.status).toBe(409);
    expect(tasks).toHaveLength(0);
  });

  it("resumes only once when two valid submissions arrive together", async () => {
    const { service, tasks } = answerSetup();
    const results = await Promise.allSettled([service.submitAnswers(runId, { answers: [] }), service.submitAnswers(runId, { answers: [] })]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(tasks).toHaveLength(1);
  });

  it("records a failed resume as a failed Run with a code and message, and never throws", async () => {
    const { service, store, answer, tasks } = answerSetup();
    answer.mockRejectedValueOnce(new CoverageError("bad", []));
    await service.submitAnswers(runId, { answers: [] });
    await tasks[0]!();
    const run = store.rows.get(runId)!;
    expect(run.status).toBe("failed");
    expect(run.error?.code).toBe("COVERAGE_FAILED");
    expect(run.error?.message).toBeTruthy();
  });

  it("maps an unexpected resume failure to INTERNAL", async () => {
    const { service, store, answer, tasks } = answerSetup();
    answer.mockRejectedValueOnce(new Error("boom"));
    await service.submitAnswers(runId, { answers: [] });
    await tasks[0]!();
    expect(store.rows.get(runId)?.error?.code).toBe("INTERNAL");
  });
});

describe("RunsService.deleteRun", () => {
  const runId = "33333333-3333-4333-8333-333333333333" as RunId;
  const now = () => new Date("2026-10-01T00:00:00Z");

  /** A store holding one Run, with the conditional delete the real store does in SQL, and a runner whose `deleteThread` is a spy. */
  function deleteSetup(deleteThread: GraphRunner["deleteThread"] = async () => {}) {
    const store = new FakeStore() as FakeStore & { deleteUnless(id: RunId, busy: RunStatus[], liveAt?: Date): Promise<boolean> };
    store.rows.set(runId, { id: runId, status: "awaiting_review", createdAt: now(), expiresAt: new Date(now().getTime() + 1000), exportPath: null, error: null });
    store.deleteUnless = async (id, busy, liveAt) => {
      const row = store.rows.get(id);
      if (!row || busy.includes(row.status) || (liveAt && row.expiresAt <= liveAt)) return false;
      store.rows.delete(id);
      return true;
    };
    const spy = vi.fn(deleteThread);
    const snapshot = null as unknown as RunSnapshot;
    const graphRunner: GraphRunner = { start: async () => snapshot, answer: async () => snapshot, recover: async () => snapshot, read: async () => null, deleteThread: spy };
    const service = new RunsService({ store: store as unknown as RunStore, config, graphRunner, events: new InProcessRunEvents(), now });
    return { store, spy, service };
  }

  it("deletes the row, then the checkpoints", async () => {
    const { store, spy, service } = deleteSetup();
    await service.deleteRun(runId);
    expect(store.rows.has(runId)).toBe(false);
    expect(spy).toHaveBeenCalledExactlyOnceWith(runId);
  });

  it("still resolves, and logs, when deleting the checkpoints fails after the row is gone", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { store, service } = deleteSetup(async () => {
        throw new Error("connection lost");
      });
      await expect(service.deleteRun(runId)).resolves.toBeUndefined();
      expect(store.rows.has(runId)).toBe(false);
      expect(error).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
    }
  });

  it("deletes nothing and leaves the checkpoints alone while the Run is busy", async () => {
    for (const status of ["parsing", "extracting", "tailoring"] as const) {
      const { store, spy, service } = deleteSetup();
      store.rows.set(runId, { ...store.rows.get(runId)!, status });
      await expect(service.deleteRun(runId)).rejects.toMatchObject({ code: "RUN_BUSY", status: 409 });
      expect(store.rows.has(runId)).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("says 404 for an unknown or malformed ID", async () => {
    const { spy, service } = deleteSetup();
    await expect(service.deleteRun("44444444-4444-4444-8444-444444444444")).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });
    await expect(service.deleteRun("nope")).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });
    expect(spy).not.toHaveBeenCalled();
  });
});
