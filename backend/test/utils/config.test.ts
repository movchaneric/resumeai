import { describe, expect, it } from "vitest";
import { loadConfig } from "@/utils/config.js";

describe("loadConfig", () => {
  it("applies the documented defaults", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://x" });
    expect(config.port).toBe(3000);
    expect(config.runTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(config.limits).toMatchObject({ maxCvBytes: 5 * 1024 * 1024, maxCvPages: 5, maxDocxChars: 30_000, maxJobDescriptionChars: 20_000, minPdfCharsPerPage: 100 });
  });

  it("reads overrides from the environment", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://x", PORT: "4000", MAX_CV_PAGES: "2", RUN_TTL_DAYS: "1" });
    expect(config.port).toBe(4000);
    expect(config.limits.maxCvPages).toBe(2);
    expect(config.runTtlMs).toBe(24 * 60 * 60 * 1000);
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("fails fast on a value that is not a number", () => {
    expect(() => loadConfig({ DATABASE_URL: "x", PORT: "abc" })).toThrow(/PORT/);
  });
});
