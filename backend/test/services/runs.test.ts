import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Coverage, RunErrorCode, RunId } from "@resume-ai/shared";
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@/utils/config.js";
import { ApiError } from "@/utils/errors.js";
import type { NewRun, RunStore, StoredRun } from "@/stores/runs.js";
import { RunsService } from "@/services/runs.js";
import { ExtractionError, NoRequirementsError } from "@/extraction/errors.js";
import { LlmUnavailableError } from "@/llm/llmClient.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { assignCvIds } from "@/extraction/assignIds.js";
import { fullCv } from "../extraction/cvFixture.js";

const cv = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));
const config = loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k" });

/** In-memory stand-in for the Prisma-backed store, so the service is tested without a database. */
class FakeStore {
  rows = new Map<string, StoredRun>();
  async create(run: NewRun): Promise<StoredRun> {
    const stored = { ...run, exportPath: null, cv: null, jobProfile: null, coverage: null, error: null };
    this.rows.set(run.id, stored);
    return stored;
  }
  async get(id: RunId): Promise<StoredRun | null> {
    return this.rows.get(id) ?? null;
  }
  async saveExtraction(id: RunId, { cv, jobProfile }: Pick<StoredRun, "cv" | "jobProfile">): Promise<void> {
    this.rows.set(id, { ...this.rows.get(id)!, cv, jobProfile });
  }
  async saveCoverage(id: RunId, coverage: Coverage[]): Promise<void> {
    this.rows.set(id, { ...this.rows.get(id)!, coverage, status: "scored" });
  }
  async markFailed(id: RunId, code: RunErrorCode, message: string): Promise<void> {
    this.rows.set(id, { ...this.rows.get(id)!, status: "failed", error: { code, message } });
  }
}

/** Text that `fullCv()` quotes verbatim, so the verbatim check passes. */
const CV_TEXT = `Ada Lovelace
Engineer.
Acme - Dev 2020 - 2022
Built a
Built b
Beta - Lead 2020 - 2022
Led c
MIT BSc CS 2020 2022
Thesis
TypeScript SQL
Proj Shipped
AWS 2021
Experience Volunteer a Volunteer b`;

const JOB_PROFILE = {
  title: "Backend Engineer",
  company: "Acme",
  requirements: [{ text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" }],
};

function setup(now = () => new Date()) {
  const store = new FakeStore();
  const llm = new FakeLlmClient();
  // Tasks are held back until `settle`, so a test can change the stored Run before extraction starts.
  const tasks: (() => Promise<void>)[] = [];
  const runInBackground = (task: () => Promise<void>) => {
    tasks.push(task);
  };
  const service = new RunsService({ store: store as unknown as RunStore, config, llm, now, runInBackground });
  /** Runs every scheduled task and waits for it. A task that rejected fails the test. */
  const settle = async () => {
    await Promise.all(tasks.map((task) => task()));
  };
  return { store, llm, tasks, settle, service };
}

/** Creates a Run and swaps in a CV text the fake extraction output quotes verbatim. */
async function createExtractableRun(ctx: ReturnType<typeof setup>) {
  const id = await ctx.service.createRun({ cv, jobDescription: "Backend developer" });
  ctx.store.rows.set(id, { ...ctx.store.rows.get(id)!, cvText: CV_TEXT });
  return id;
}

/** A made-up Job Profile and CV, stored as if extraction had finished. */
const STORED_JOB_PROFILE = {
  title: "Backend Engineer",
  company: "Acme",
  requirements: [
    { id: "req1", text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" },
    { id: "req2", text: "PostgreSQL", source: "PostgreSQL", kind: "skill", importance: "must_have" },
    { id: "req3", text: "Docker", source: "Docker", kind: "skill", importance: "nice_to_have" },
  ],
} as unknown as NonNullable<StoredRun["jobProfile"]>;

const STORED_COVERAGE = [
  { requirementId: "req3", verdict: "unmet", evidenceIds: [], reason: "No Docker." },
  { requirementId: "req1", verdict: "met", evidenceIds: ["exp1.b1"], reason: "Built Node.js services." },
  { requirementId: "req2", verdict: "partially_met", evidenceIds: ["skill1"], reason: "Listed only." },
] as unknown as Coverage[];

/** Creates a Run and overwrites its stored state, to test the view without running the pipeline. */
async function createRunWith(ctx: ReturnType<typeof setup>, patch: Partial<StoredRun>) {
  const id = await ctx.service.createRun({ cv, jobDescription: "Backend developer" });
  ctx.store.rows.set(id, { ...ctx.store.rows.get(id)!, ...patch });
  return id;
}

const stepStates = (view: { steps: { key: string; state: string }[] }) =>
  view.steps.filter((s) => s.state !== "pending").map((s) => `${s.key}:${s.state}`);

const code = (error: unknown) => (error instanceof ApiError ? error.code : error);

describe("RunsService", () => {
  it("stores the parsed CV and the trimmed job description", async () => {
    const { store, service } = setup();
    const id = await service.createRun({ cv, jobDescription: "  Backend developer \u0000 " });
    const row = store.rows.get(id)!;
    expect(row.jobDescriptionText).toBe("Backend developer");
    expect(row.cvText).toContain("Jane Doe");
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

  describe("extraction", () => {
    it("schedules extraction when a Run is created", async () => {
      const ctx = setup();
      ctx.llm.enqueue("extract_job_profile", JOB_PROFILE).enqueue("extract_cv", fullCv());
      await createExtractableRun(ctx);
      expect(ctx.tasks).toHaveLength(1);
      await ctx.settle();
    });

    it("shows the Run as extracting with extract running until the results are stored", async () => {
      const { service } = setup();
      const id = await service.createRun({ cv, jobDescription: "Backend developer" });
      const view = await service.getRunView(id);
      expect(view.status).toBe("extracting");
      expect(view.job).toBeNull();
      expect(view.steps.filter((s) => s.state !== "pending")).toEqual([
        { key: "parse", state: "done" },
        { key: "extract", state: "running" },
      ]);
    });

    it("saves both results and shows extract done with the job", async () => {
      const ctx = setup();
      ctx.llm.enqueue("extract_job_profile", JOB_PROFILE).enqueue("extract_cv", fullCv());
      const id = await createExtractableRun(ctx);
      await ctx.settle();

      const row = ctx.store.rows.get(id)!;
      expect(row.cv?.experience[0]?.id).toBe("exp1");
      expect(row.jobProfile?.requirements[0]?.id).toBe("req1");
      expect(ctx.llm.calls.map((c) => c.name)).toEqual(["extract_job_profile", "extract_cv"]);

      const view = await ctx.service.getRunView(id);
      expect(view.status).toBe("extracting");
      expect(view.job).toEqual({ title: "Backend Engineer", company: "Acme" });
      expect(view.steps.find((s) => s.key === "extract")?.state).toBe("done");
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
      expect(ctx.store.rows.get(id)?.cv).toBeNull();
      expect((await ctx.service.getRunView(id)).status).toBe("failed");
    });

    it("never throws, even when the store fails or the Run is gone", async () => {
      const ctx = setup();
      ctx.llm.enqueue("extract_job_profile", new Error("boom"));
      const id = await createExtractableRun(ctx);
      ctx.store.markFailed = async () => {
        throw new Error("db down");
      };
      await expect(ctx.settle()).resolves.toBeUndefined();

      await expect(ctx.service.extractRun("00000000-0000-4000-8000-000000000000" as RunId)).resolves.toBeUndefined();
      expect(id).toBeDefined();
    });

    it("with the default background runner, a store that throws on every write leaves no unhandled rejection", async () => {
      const store = new FakeStore();
      store.saveExtraction = async () => {
        throw new Error("db down");
      };
      store.markFailed = async () => {
        throw new Error("db down");
      };
      const llm = new FakeLlmClient();
      llm.enqueue("extract_job_profile", JOB_PROFILE).enqueue("extract_cv", fullCv());
      // No runInBackground: this is the production runner.
      const service = new RunsService({ store: store as unknown as RunStore, config, llm });
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const id = await service.createRun({ cv, jobDescription: "Backend developer" });
        store.rows.set(id, { ...store.rows.get(id)!, cvText: CV_TEXT });
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
      expect(calls).toEqual([`Run ${id}: extraction failed (EXTRACTION_FAILED) ExtractionError, 1 issues`]);
    });
  });

  describe("run view", () => {
    const failure = { code: "COVERAGE_FAILED", message: "m" } as const;

    it("extracting, no results: extract running, no job", async () => {
      const ctx = setup();
      const view = await ctx.service.getRunView(await createRunWith(ctx, {}));
      expect(view.status).toBe("extracting");
      expect(view.job).toBeNull();
      expect(stepStates(view)).toEqual(["parse:done", "extract:running"]);
    });

    it("extracting, results stored: extract done, coverage running, job shown", async () => {
      const ctx = setup();
      const id = await createRunWith(ctx, { cv: assignCvIds(fullCv()), jobProfile: STORED_JOB_PROFILE });
      const view = await ctx.service.getRunView(id);
      expect(view.status).toBe("extracting");
      expect(view.job).toEqual({ title: "Backend Engineer", company: "Acme" });
      expect(stepStates(view)).toEqual(["parse:done", "extract:done", "coverage:running"]);
    });

    it("scored: all three steps done, rounded score, requirements in Job Profile order", async () => {
      const ctx = setup();
      const id = await createRunWith(ctx, {
        status: "scored",
        cv: assignCvIds(fullCv()),
        jobProfile: STORED_JOB_PROFILE,
        coverage: STORED_COVERAGE,
      });
      const view = await ctx.service.getRunView(id);
      expect(view.status).toBe("scored");
      if (view.status !== "scored") return;
      // 100 x (3 + 1.5 + 0) / 7 = 64.28...
      expect(view.score).toBe(64);
      expect(view.job).toEqual({ title: "Backend Engineer", company: "Acme" });
      expect(stepStates(view)).toEqual(["parse:done", "extract:done", "coverage:done"]);
      expect(view.requirements).toEqual([
        { id: "req1", text: "Node.js", importance: "must_have", verdict: "met", evidenceIds: ["exp1.b1"], reason: "Built Node.js services." },
        { id: "req2", text: "PostgreSQL", importance: "must_have", verdict: "partially_met", evidenceIds: ["skill1"], reason: "Listed only." },
        { id: "req3", text: "Docker", importance: "nice_to_have", verdict: "unmet", evidenceIds: [], reason: "No Docker." },
      ]);
    });

    it("failed before extraction was stored: extract failed, no job", async () => {
      const ctx = setup();
      const id = await createRunWith(ctx, { status: "failed", error: { code: "EXTRACTION_FAILED", message: "m" } });
      const view = await ctx.service.getRunView(id);
      expect(view.status).toBe("failed");
      expect(view.job).toBeNull();
      expect(stepStates(view)).toEqual(["parse:done", "extract:failed"]);
    });

    it("failed with extraction stored: coverage failed, extract done", async () => {
      const ctx = setup();
      const id = await createRunWith(ctx, { status: "failed", cv: assignCvIds(fullCv()), jobProfile: STORED_JOB_PROFILE, error: failure });
      const view = await ctx.service.getRunView(id);
      expect(view.status).toBe("failed");
      if (view.status !== "failed") return;
      expect(view.error.code).toBe("COVERAGE_FAILED");
      expect(view.job).toEqual({ title: "Backend Engineer", company: "Acme" });
      expect(stepStates(view)).toEqual(["parse:done", "extract:done", "coverage:failed"]);
    });
  });
});
