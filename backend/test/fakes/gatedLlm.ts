import type { z } from "zod";
import type { LlmMessage } from "@/llm/llmClient.js";
import { FakeLlmClient } from "./fakeLlmClient.js";

/** A fake model whose calls to a named step wait until the test releases them, so a Run can be held mid-flight. */
export class GatedLlm extends FakeLlmClient {
  private readonly gates = new Map<string, Promise<void>>();
  /** The name of each call that arrived at a gate, in order (a call is in `calls` only after it passes its gate). */
  readonly held: string[] = [];

  hold(name: string): () => void {
    let release!: () => void;
    this.gates.set(name, new Promise<void>((resolve) => (release = resolve)));
    return release;
  }

  reset(): void {
    this.gates.clear();
    this.held.length = 0;
    this.calls.length = 0;
  }

  override async structured<T>(schema: z.ZodType<T>, messages: LlmMessage[], options: { name: string }): Promise<T> {
    const gate = this.gates.get(options.name);
    if (gate) {
      this.held.push(options.name);
      await gate;
    }
    return super.structured(schema, messages, options);
  }
}
