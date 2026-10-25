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

    it("ends at awaiting_review with zero rounds: before equals after, no Changes, exit reason ceiling", async () => {
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
      expect(view.exitReason).toBe("ceiling");
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
