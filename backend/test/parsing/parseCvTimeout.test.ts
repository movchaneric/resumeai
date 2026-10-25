import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/utils/errors.js";
import { loadConfig } from "@/utils/config.js";
import { parseCv } from "@/parsing/parseCv.js";

// The PDF reader never answers, so only the timeout can end the parse: nothing races it.
vi.mock("unpdf", () => ({
  getDocumentProxy: () => new Promise(() => {}),
  extractTextItems: () => new Promise(() => {}),
}));

const { limits } = loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k" });

describe("parseCv timeout", () => {
  it("rejects a parse that never finishes", async () => {
    const buffer = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));
    const error = await parseCv(buffer, { ...limits, parseTimeoutMs: 20 }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("UNREADABLE_FILE");
  });
});
