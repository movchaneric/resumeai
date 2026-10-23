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
};

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
      temperature: 0,
      timeout: options.timeoutMs,
      maxRetries: 0,
      // LangChain's own `reasoning` option is dropped for non-OpenAI model names; modelKwargs reaches the request body.
      modelKwargs: { reasoning_effort: "none" },
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

    let result: RawStructured;
    try {
      result = (await runnable.invoke(messages)) as RawStructured;
    } catch (cause) {
      // LangChain/OpenAI parse the reply inside the call, so unparseable or schema-breaking output arrives as a throw.
      const parseIssues = issuesFromParseError(cause);
      if (parseIssues) {
        throw new LlmSchemaError(`Model output for "${options.name}" does not match the schema`, parseIssues);
      }
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new LlmUnavailableError(`Model call "${options.name}" failed: ${detail}`, { cause });
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
