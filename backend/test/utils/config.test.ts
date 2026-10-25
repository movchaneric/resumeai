import { describe, expect, it } from "vitest";
import { loadConfig } from "@/utils/config.js";

describe("loadConfig", () => {
  it("applies the documented defaults", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://x", OPENAI_API_KEY: "k" });
    expect(config.port).toBe(3000);
    expect(config.runTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(config.limits).toMatchObject({ maxCvBytes: 5 * 1024 * 1024, maxCvPages: 5, maxDocxChars: 30_000, maxJobDescriptionChars: 20_000, minPdfCharsPerPage: 100 });
  });

  it("reads overrides from the environment", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://x", OPENAI_API_KEY: "k", PORT: "4000", MAX_CV_PAGES: "2", RUN_TTL_DAYS: "1" });
    expect(config.port).toBe(4000);
    expect(config.limits.maxCvPages).toBe(2);
    expect(config.runTtlMs).toBe(24 * 60 * 60 * 1000);
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("fails fast on a value that is not a number", () => {
    expect(() => loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", PORT: "abc" })).toThrow(/PORT/);
  });

  it("applies the LLM and tracing defaults", () => {
    const config = loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k" });
    expect(config.llm).toEqual({ apiKey: "k", baseUrl: undefined, model: "gpt-4.1-mini", judgeModel: "gpt-4.1-mini", contextTokens: 128_000, timeoutMs: 60_000, reasoningEffort: undefined });
    expect(config.tracing).toEqual({ traceContent: false, endpoint: undefined, projectName: undefined });
  });

  it("reads LLM and tracing overrides", () => {
    const config = loadConfig({
      DATABASE_URL: "x",
      OPENAI_API_KEY: "k",
      OPENAI_BASE_URL: "http://localhost:11434/v1",
      LLM_MODEL: "m",
      TRACE_CONTENT: "true",
      PHOENIX_COLLECTOR_ENDPOINT: "http://localhost:6006",
      PHOENIX_PROJECT_NAME: "p",
    });
    expect(config.llm.baseUrl).toBe("http://localhost:11434/v1");
    expect(config.llm.model).toBe("m");
    expect(config.tracing).toEqual({ traceContent: true, endpoint: "http://localhost:6006", projectName: "p" });
  });

  it("passes LLM_REASONING_EFFORT through and rejects an empty value", () => {
    expect(loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", LLM_REASONING_EFFORT: "none" }).llm.reasoningEffort).toBe("none");
    expect(() => loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", LLM_REASONING_EFFORT: "" })).toThrow(/LLM_REASONING_EFFORT/);
  });

  it("defaults judgeModel to LLM_MODEL, lets LLM_JUDGE_MODEL override it, and rejects an empty value", () => {
    const base = { DATABASE_URL: "x", OPENAI_API_KEY: "k" };
    expect(loadConfig({ ...base, LLM_MODEL: "m" }).llm.judgeModel).toBe("m");
    expect(loadConfig({ ...base, LLM_MODEL: "m", LLM_JUDGE_MODEL: "big" }).llm).toMatchObject({ model: "m", judgeModel: "big" });
    expect(() => loadConfig({ ...base, LLM_JUDGE_MODEL: "" })).toThrow(/LLM_JUDGE_MODEL/);
    expect(loadConfig({ ...base, LLM_MODEL: "m", LLM_COVERAGE_MODEL: "old" }).llm.judgeModel).toBe("m");
  });

  it("fails fast when OPENAI_API_KEY is missing", () => {
    expect(() => loadConfig({ DATABASE_URL: "x" })).toThrow(/OPENAI_API_KEY/);
  });

  it("refuses TRACE_CONTENT=true in production", () => {
    expect(() => loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", NODE_ENV: "production", TRACE_CONTENT: "true" })).toThrow(
      /0006-trace-content-is-outside-run-deletion/,
    );
    expect(() => loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", NODE_ENV: "production" })).not.toThrow();
  });
});
