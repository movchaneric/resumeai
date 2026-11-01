import { describe, expect, it } from "vitest";
import { describeLlmSettings, loadConfig } from "@/utils/config.js";

describe("loadConfig", () => {
  it("applies the documented defaults", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32) });
    expect(config.port).toBe(3000);
    expect(config.runTtlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(config.limits).toMatchObject({ maxCvBytes: 5 * 1024 * 1024, maxCvPages: 5, maxDocxChars: 30_000, maxJobDescriptionChars: 20_000, minPdfCharsPerPage: 100 });
  });

  it("reads overrides from the environment", () => {
    const config = loadConfig({ DATABASE_URL: "postgresql://x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32), PORT: "4000", MAX_CV_PAGES: "2", RUN_TTL_DAYS: "1" });
    expect(config.port).toBe(4000);
    expect(config.limits.maxCvPages).toBe(2);
    expect(config.runTtlMs).toBe(24 * 60 * 60 * 1000);
  });

  it("fails fast when DATABASE_URL is missing", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("fails fast on a value that is not a number", () => {
    expect(() => loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32), PORT: "abc" })).toThrow(/PORT/);
  });

  it("applies the LLM and tracing defaults", () => {
    const config = loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32) });
    expect(config.llm).toEqual({ apiKey: "k", baseUrl: undefined, model: "gpt-4.1-mini", judgeModel: "gpt-4.1-mini", contextTokens: 128_000, timeoutMs: 60_000, reasoningEffort: undefined });
    expect(config.tracing).toEqual({ traceContent: false, endpoint: undefined, projectName: undefined });
  });

  it("reads LLM and tracing overrides", () => {
    const config = loadConfig({
      DATABASE_URL: "x",
      OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32),
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
    expect(loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32), LLM_REASONING_EFFORT: "none" }).llm.reasoningEffort).toBe("none");
    expect(() => loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32), LLM_REASONING_EFFORT: "" })).toThrow(/LLM_REASONING_EFFORT/);
  });

  it("defaults judgeModel to LLM_MODEL, lets LLM_JUDGE_MODEL override it, and rejects an empty value", () => {
    const base = { DATABASE_URL: "x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32) };
    expect(loadConfig({ ...base, LLM_MODEL: "m" }).llm.judgeModel).toBe("m");
    expect(loadConfig({ ...base, LLM_MODEL: "m", LLM_JUDGE_MODEL: "big" }).llm).toMatchObject({ model: "m", judgeModel: "big" });
    expect(() => loadConfig({ ...base, LLM_JUDGE_MODEL: "" })).toThrow(/LLM_JUDGE_MODEL/);
    expect(loadConfig({ ...base, LLM_MODEL: "m", LLM_COVERAGE_MODEL: "old" }).llm.judgeModel).toBe("m");
  });

  it("fails fast when OPENAI_API_KEY is missing", () => {
    expect(() => loadConfig({ DATABASE_URL: "x" })).toThrow(/OPENAI_API_KEY/);
  });

  it("refuses TRACE_CONTENT=true in production", () => {
    expect(() => loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32), NODE_ENV: "production", TRACE_CONTENT: "true" })).toThrow(
      /0006-trace-content-is-outside-run-deletion/,
    );
    expect(() => loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32), NODE_ENV: "production" })).not.toThrow();
  });
});

describe("describeLlmSettings", () => {
  it("shows the model, judge model, timeout and the base URL host only", () => {
    const config = loadConfig({
      DATABASE_URL: "x",
      OPENAI_API_KEY: "sk-secret",
      BETTER_AUTH_SECRET: "s".repeat(32),
      OPENAI_BASE_URL: "https://user:pass@generativelanguage.googleapis.com/v1beta/openai/?key=abc",
      LLM_MODEL: "gemini-3.5-flash-lite",
      LLM_TIMEOUT_MS: "120000",
    });
    const line = describeLlmSettings(config.llm);
    expect(line).toBe("model=gemini-3.5-flash-lite, judge=gemini-3.5-flash-lite, timeoutMs=120000, llmHost=generativelanguage.googleapis.com");
    expect(line).not.toMatch(/sk-secret|pass|abc|v1beta/);
  });

  it("names the OpenAI host when no base URL is set", () => {
    const config = loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32), LLM_JUDGE_MODEL: "judge-1" });
    expect(describeLlmSettings(config.llm)).toBe("model=gpt-4.1-mini, judge=judge-1, timeoutMs=60000, llmHost=api.openai.com");
  });

  describe("auth settings", () => {
    const base = { DATABASE_URL: "x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32) };

    it("fails fast when BETTER_AUTH_SECRET is missing or shorter than 32 characters", () => {
      expect(() => loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k" })).toThrow(/BETTER_AUTH_SECRET/);
      expect(() => loadConfig({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
    });

    it("applies the defaults: local origin, no Google, rate limiting on", () => {
      expect(loadConfig(base).auth).toEqual({ secret: "s".repeat(32), appOrigin: "http://localhost:5173", google: undefined, rateLimit: true });
    });

    it("takes the Google pair together, and refuses only one of them", () => {
      expect(loadConfig({ ...base, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }).auth.google).toEqual({ clientId: "id", clientSecret: "secret" });
      expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: "id" })).toThrow(/GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
      expect(() => loadConfig({ ...base, GOOGLE_CLIENT_SECRET: "secret" })).toThrow(/GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
    });
  });
});
