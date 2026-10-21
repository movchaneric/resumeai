import { describe, expect, it } from "vitest";
import { assertFitsContext, estimateTokens } from "@/llm/contextGuard.js";
import { LlmUnavailableError } from "@/llm/llmClient.js";

const msg = (n: number) => [{ role: "user" as const, content: "x".repeat(n) }];

describe("assertFitsContext", () => {
  it("estimates one token per three characters, rounded up", () => {
    expect(estimateTokens(msg(9))).toBe(3);
    expect(estimateTokens(msg(10))).toBe(4);
  });

  it("passes exactly at the budget", () => {
    // 3000 chars = 1000 tokens, + 500 reserve = 1500
    expect(() => assertFitsContext(msg(3000), { contextTokens: 1500, outputReserve: 500 })).not.toThrow();
  });

  it("throws just over the budget, naming both numbers", () => {
    try {
      assertFitsContext(msg(3001), { contextTokens: 1500, outputReserve: 500 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LlmUnavailableError);
      expect((e as Error).message).toContain("1501");
      expect((e as Error).message).toContain("1500");
    }
  });

  it("counts every message and defaults the reserve to 4096", () => {
    const two = [...msg(3000), ...msg(3000)];
    expect(() => assertFitsContext(two, { contextTokens: 2000 + 4096 })).not.toThrow();
    expect(() => assertFitsContext(two, { contextTokens: 2000 + 4095 })).toThrow(LlmUnavailableError);
  });
});
