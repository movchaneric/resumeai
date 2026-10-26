import type { z } from "zod";
import { COVERAGE_VOTES } from "@/scoring/assessCoverage.js";
import type { LlmClient, LlmMessage } from "@/llm/llmClient.js";

export type FakeResponse = unknown;

/** Queues responses per call `name`. A queued Error is thrown; any other value is returned. */
export class FakeLlmClient implements LlmClient {
  readonly calls: { name: string; messages: LlmMessage[] }[] = [];
  private readonly queues = new Map<string, FakeResponse[]>();

  enqueue(name: string, ...responses: FakeResponse[]): this {
    this.queues.set(name, [...(this.queues.get(name) ?? []), ...responses]);
    return this;
  }

  /**
   * Queues each response `votes` times in a row, for a step the product repeats in parallel (Coverage).
   * The parallel calls make their first attempts before any retry, so a retry sequence stays in order.
   */
  enqueueVoted(name: string, ...responses: FakeResponse[]): this {
    return this.enqueue(name, ...responses.flatMap((r) => Array.from({ length: COVERAGE_VOTES }, () => r)));
  }

  async structured<T>(_schema: z.ZodType<T>, messages: LlmMessage[], options: { name: string }): Promise<T> {
    this.calls.push({ name: options.name, messages });
    const queue = this.queues.get(options.name);
    if (!queue || queue.length === 0) {
      throw new Error(`FakeLlmClient: no response queued for "${options.name}" (call ${this.calls.length})`);
    }
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next as T;
  }
}
