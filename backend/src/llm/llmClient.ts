import type { z } from "zod";

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export interface LlmClient {
  /** One structured call. Resolves with output that already passed `schema.parse`, or throws. */
  structured<T>(schema: z.ZodType<T>, messages: LlmMessage[], options: { name: string }): Promise<T>;
}

/** The model answered, but the output did not match the schema. `issues` are `path: message` lines. */
export class LlmSchemaError extends Error {
  constructor(
    message: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = "LlmSchemaError";
  }
}

/** The model could not be used: unreachable, timeout, HTTP error, or the context budget was exceeded. */
export class LlmUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LlmUnavailableError";
  }
}
