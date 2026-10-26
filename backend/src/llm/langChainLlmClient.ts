import { ChatOpenAI } from "@langchain/openai";
import type { z } from "zod";
import { assertFitsContext } from "@/llm/contextGuard.js";
import { LlmSchemaError, LlmUnavailableError, type LlmClient, type LlmMessage } from "@/llm/llmClient.js";

export type LangChainLlmOptions = {
  apiKey: string;
  baseUrl?: string;
  model: string;
  contextTokens: number;
  timeoutMs: number;
  /** Sent as `reasoning_effort` when set. Leave unset for models that reject it (gpt-4o-mini, gpt-4.1-*). */
  reasoningEffort?: string;
  /** Waits before each retry of a transient failure, so `[1000, 4000]` means up to two retries. Tests pass `[0, 0]`. */
  retryDelaysMs?: number[];
};

/** HTTP statuses worth retrying. A 429 with code `insufficient_quota` is excluded in `isTransient`. */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_DELAYS_MS = [1000, 4000];

type RawStructured = { raw?: unknown; parsed?: unknown; parsingError?: unknown };

function issueLines(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
}

/** Readable issues when `error` is a parse or validation failure of the model output, else undefined. */
function issuesFromParseError(error: unknown): string[] | undefined {
  if (error instanceof SyntaxError) return [`output is not valid JSON: ${error.message}`];
  const e = error as { name?: string; issues?: z.core.$ZodIssue[]; llmOutput?: unknown } | null;
  if (e && Array.isArray(e.issues)) {
    return e.issues.map((i) => `${i.path?.length ? i.path.join(".") : "(root)"}: ${i.message}`);
  }
  if (e?.name === "OutputParserException") return [String((error as Error).message)];
  return undefined;
}

type FailureDetails = { status?: number; code?: string };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/** A short provider code only: letters, digits, `_`, `-`, `.`. Anything else (message text) is dropped. */
function shortCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(value) ? value : undefined;
}

/**
 * The content-free status and code of a failed model call. The error may be the OpenAI SDK's `APIError`
 * (`status`, `code`, `type`, `error` body), possibly wrapped by LangChain (`cause`), and Gemini's OpenAI-compatible
 * endpoint answers with a JSON list `[{"error":{"code":503,"status":"UNAVAILABLE"}}]`.
 */
function failureDetails(cause: unknown): FailureDetails {
  for (let e: unknown = cause, depth = 0; e !== undefined && depth < 4; e = asRecord(e)?.cause, depth++) {
    const err = asRecord(e);
    if (!err) break;
    // The SDK's errors all report `name: "Error"`, so the class name is the reliable marker; LangChain's own timeout is a "TimeoutError".
    const kind = (e as object).constructor?.name;
    if (kind === "APIConnectionTimeoutError" || err.name === "TimeoutError") return { code: "timeout" };
    if (kind === "APIConnectionError") return { code: "connection" };
    const body = asRecord(Array.isArray(err.error) ? err.error[0] : err.error);
    const inner = asRecord(body?.error) ?? body;
    const status = [err.status, inner?.code, body?.code].find((v): v is number => typeof v === "number");
    const code = shortCode(err.code) ?? shortCode(inner?.code) ?? shortCode(inner?.status) ?? shortCode(err.type) ?? shortCode(inner?.type);
    if (status !== undefined || code !== undefined) {
      return { ...(status !== undefined ? { status } : {}), ...(code !== undefined ? { code } : {}) };
    }
  }
  return {};
}

function isTransient({ status, code }: FailureDetails): boolean {
  return status !== undefined && TRANSIENT_STATUSES.has(status) && code !== "insufficient_quota";
}

const sleep = (ms: number) => (ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export class LangChainLlmClient implements LlmClient {
  private readonly model: ChatOpenAI;

  /** `fetchImpl` is for tests: it replaces the HTTP layer so no network is needed. */
  constructor(
    private readonly options: LangChainLlmOptions,
    fetchImpl?: typeof fetch,
  ) {
    this.model = new ChatOpenAI({
      apiKey: options.apiKey,
      model: options.model,
      // OpenAI rejects `temperature` once reasoning is on, so send it only when reasoning is unset or "none".
      ...(!options.reasoningEffort || options.reasoningEffort === "none" ? { temperature: 0 } : {}),
      timeout: options.timeoutMs,
      // Retries live in `structured()` (transient HTTP failures only), so the SDK must not retry as well.
      maxRetries: 0,
      // Two rules. `reasoning_effort` is sent only when configured, because non-reasoning models (gpt-4o-mini,
      // gpt-4.1-*) reject it. `temperature: 0` is sent only when it is unset or "none", because reasoning efforts
      // above "none" reject temperature. LangChain's own `reasoning` option is dropped for non-OpenAI model names;
      // modelKwargs reaches the request body.
      ...(options.reasoningEffort ? { modelKwargs: { reasoning_effort: options.reasoningEffort } } : {}),
      configuration: { baseURL: options.baseUrl, ...(fetchImpl ? { fetch: fetchImpl } : {}) },
    });
  }

  async structured<T>(schema: z.ZodType<T>, messages: LlmMessage[], options: { name: string }): Promise<T> {
    assertFitsContext(messages, { contextTokens: this.options.contextTokens });

    const runnable = this.model.withStructuredOutput(schema as z.ZodType<Record<string, unknown>>, {
      method: "jsonSchema",
      strict: true,
      includeRaw: true,
      name: options.name,
    });

    const delays = this.options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    let result: RawStructured;
    for (let attempt = 0; ; attempt++) {
      try {
        result = (await runnable.invoke(messages)) as RawStructured;
        break;
      } catch (cause) {
        // LangChain/OpenAI parse the reply inside the call, so unparseable or schema-breaking output arrives as a throw.
        const parseIssues = issuesFromParseError(cause);
        if (parseIssues) {
          throw new LlmSchemaError(`Model output for "${options.name}" does not match the schema`, parseIssues);
        }
        const details = failureDetails(cause);
        if (attempt < delays.length && isTransient(details)) {
          await sleep(delays[attempt]!);
          continue;
        }
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new LlmUnavailableError(`Model call "${options.name}" failed: ${detail}`, { cause, ...details });
      }
    }

    if (result.parsingError || result.parsed == null) {
      const detail = result.parsingError instanceof Error ? result.parsingError.message : "the model returned no structured output";
      throw new LlmSchemaError(`Model output for "${options.name}" could not be parsed`, [detail]);
    }

    const checked = schema.safeParse(result.parsed);
    if (!checked.success) {
      throw new LlmSchemaError(`Model output for "${options.name}" does not match the schema`, issueLines(checked.error));
    }
    return checked.data;
  }
}
