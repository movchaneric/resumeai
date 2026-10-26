import { z } from "zod";
import { describe, expect, it } from "vitest";
import { extractionVersion, jobProfileCacheKey, normalizeJobDescription } from "@/extraction/jobProfileKey.js";

describe("normalizeJobDescription", () => {
  it("unifies line endings, collapses whitespace runs and trims", () => {
    expect(normalizeJobDescription("  Backend\r\n\r\n\r\ndeveloper \t at   Initech\r")).toBe("Backend\n\ndeveloper at Initech");
  });
});

describe("jobProfileCacheKey", () => {
  const text = "We need a backend developer.\nNode.js required.";

  it("is a sha256 hex digest", () => {
    expect(jobProfileCacheKey(text, "model-a")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same for the same text", () => {
    expect(jobProfileCacheKey(text, "model-a")).toBe(jobProfileCacheKey(text, "model-a"));
  });

  it("ignores differences in whitespace and line endings only", () => {
    const messy = "  We need a  backend developer.\r\nNode.js   required.\r\n\r\n";
    expect(jobProfileCacheKey(messy, "model-a")).toBe(jobProfileCacheKey(text, "model-a"));
  });

  it("differs for different text", () => {
    expect(jobProfileCacheKey(text + " Go.", "model-a")).not.toBe(jobProfileCacheKey(text, "model-a"));
  });

  it("differs for a different model name", () => {
    expect(jobProfileCacheKey(text, "model-b")).not.toBe(jobProfileCacheKey(text, "model-a"));
  });
});

describe("extractionVersion", () => {
  const schema = z.object({ kind: z.enum(["skill", "other"]) });
  const base = { modelName: "m", prompt: "p", schema };

  it("is stable for the same inputs", () => {
    expect(extractionVersion(base)).toBe(extractionVersion({ ...base }));
  });

  it("changes with the model name, the prompt and the schema", () => {
    const version = extractionVersion(base);
    expect(extractionVersion({ ...base, modelName: "m2" })).not.toBe(version);
    expect(extractionVersion({ ...base, prompt: "p2" })).not.toBe(version);
    expect(extractionVersion({ ...base, schema: z.object({ kind: z.enum(["skill", "other", "soft_skill"]) }) })).not.toBe(version);
  });
});
