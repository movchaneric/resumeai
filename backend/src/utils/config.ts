import { z } from "zod";

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  RUN_TTL_DAYS: z.coerce.number().positive().default(7),
  MAX_CV_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  MAX_CV_PAGES: z.coerce.number().int().positive().default(5),
  MAX_DOCX_CHARS: z.coerce.number().int().positive().default(30_000),
  MAX_JOB_DESCRIPTION_CHARS: z.coerce.number().int().positive().default(20_000),
  /** A PDF averaging fewer extracted characters per page than this is treated as a scan. */
  MIN_PDF_CHARS_PER_PAGE: z.coerce.number().nonnegative().default(100),
  PARSE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  NODE_ENV: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_BASE_URL: z.url().optional(),
  LLM_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  LLM_JUDGE_MODEL: z.string().min(1).optional(),
  LLM_CONTEXT_TOKENS: z.coerce.number().int().positive().default(128_000),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  LLM_REASONING_EFFORT: z.string().min(1).optional(),
  TRACE_CONTENT: z.enum(["true", "false"]).default("false"),
  PHOENIX_COLLECTOR_ENDPOINT: z.url().optional(),
  PHOENIX_PROJECT_NAME: z.string().min(1).optional(),
});

export type Config = ReturnType<typeof loadConfig>;

/** Reads the environment once and fails fast with a readable message when it is wrong. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === "production" && e.TRACE_CONTENT === "true") {
    throw new Error(
      "Invalid configuration: TRACE_CONTENT=true is not allowed when NODE_ENV=production. " +
        "Trace content sits outside Run deletion; see docs/adr/0006-trace-content-is-outside-run-deletion.md",
    );
  }
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    runTtlMs: e.RUN_TTL_DAYS * 24 * 60 * 60 * 1000,
    limits: {
      maxCvBytes: e.MAX_CV_BYTES,
      maxCvPages: e.MAX_CV_PAGES,
      maxDocxChars: e.MAX_DOCX_CHARS,
      maxJobDescriptionChars: e.MAX_JOB_DESCRIPTION_CHARS,
      minPdfCharsPerPage: e.MIN_PDF_CHARS_PER_PAGE,
      parseTimeoutMs: e.PARSE_TIMEOUT_MS,
    },
    llm: {
      apiKey: e.OPENAI_API_KEY,
      baseUrl: e.OPENAI_BASE_URL,
      model: e.LLM_MODEL,
      judgeModel: e.LLM_JUDGE_MODEL ?? e.LLM_MODEL,
      contextTokens: e.LLM_CONTEXT_TOKENS,
      timeoutMs: e.LLM_TIMEOUT_MS,
      reasoningEffort: e.LLM_REASONING_EFFORT,
    },
    tracing: {
      traceContent: e.TRACE_CONTENT === "true",
      endpoint: e.PHOENIX_COLLECTOR_ENDPOINT,
      projectName: e.PHOENIX_PROJECT_NAME,
    },
  };
}
