import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunId } from "@resume-ai/shared";
import { describe, expect, it } from "vitest";
import { loadConfig } from "@/config.js";
import { ApiError } from "@/errors.js";
import type { NewRun, RunStore, StoredRun } from "@/runs/run-store.js";
import { RunsService } from "@/runs/runs.service.js";

const cv = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../test/fixtures/cv.pdf"));
const config = loadConfig({ DATABASE_URL: "x" });

/** In-memory stand-in for the Prisma-backed store, so the service is tested without a database. */
class FakeStore {
  rows = new Map<string, StoredRun>();
  async create(run: NewRun): Promise<StoredRun> {
    const stored = { ...run, createdAt: new Date(), exportPath: null };
    this.rows.set(run.id, stored);
    return stored;
  }
  async get(id: RunId): Promise<StoredRun | null> {
    return this.rows.get(id) ?? null;
  }
}

function setup(now = () => new Date()) {
  const store = new FakeStore();
  return { store, service: new RunsService({ store: store as unknown as RunStore, config, now }) };
}

const code = (error: unknown) => (error instanceof ApiError ? error.code : error);

describe("RunsService", () => {
  it("stores the parsed CV and the trimmed job description", async () => {
    const { store, service } = setup();
    const id = await service.createRun({ cv, jobDescription: "  Backend developer \u0000 " });
    const row = store.rows.get(id)!;
    expect(row.jdText).toBe("Backend developer");
    expect(row.cvText).toContain("Jane Doe");
  });

  it("sets the expiry from the configured time-to-live", async () => {
    const start = new Date("2026-10-01T00:00:00Z");
    const { store, service } = setup(() => start);
    const id = await service.createRun({ cv, jobDescription: "Backend developer" });
    expect(store.rows.get(id)!.expiresAt.getTime()).toBe(start.getTime() + config.runTtlMs);
  });

  it("rejects an empty or over-long job description before parsing the CV", async () => {
    const { store, service } = setup();
    const garbage = Buffer.from("not a cv");
    expect(code(await service.createRun({ cv: garbage, jobDescription: "   " }).catch((e) => e))).toBe("BAD_REQUEST");
    const long = "x".repeat(config.limits.maxJdChars + 1);
    expect(code(await service.createRun({ cv: garbage, jobDescription: long }).catch((e) => e))).toBe("JOB_DESCRIPTION_TOO_LONG");
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
});
