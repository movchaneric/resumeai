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

/**
 * The model could not be used: unreachable, timeout, HTTP error, or the context budget was exceeded.
 * `status` and `code` are content-free (an HTTP status, a short provider code, "timeout" or "connection"), so they are safe to log.
 */
export class LlmUnavailableError extends Error {
  readonly status?: number;
  readonly code?: string;

  constructor(message: string, options?: { cause?: unknown; status?: number; code?: string }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LlmUnavailableError";
    if (options?.status !== undefined) this.status = options.status;
    if (options?.code !== undefined) this.code = options.code;
  }
}

/** The error's name plus ` status=` and ` code=` when it is an `LlmUnavailableError` that has them. Never includes the message. */
export function describeFailure(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  if (!(error instanceof LlmUnavailableError)) return name;
  const status = error.status === undefined ? "" : ` status=${error.status}`;
  const code = error.code === undefined ? "" : ` code=${error.code}`;
  return `${name}${status}${code}`;
}
