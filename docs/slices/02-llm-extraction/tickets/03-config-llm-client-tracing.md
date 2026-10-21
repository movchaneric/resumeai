# 03 Config, LlmClient, tracing

**Goal:** the backend can make one validated structured call to the configured model through a small `LlmClient` interface, with a context-size guard, Phoenix tracing, and a fake for tests. This is the seam every later ticket uses.

**Waits for:** 01. May run while 02 is still in progress.

**Plan sections:** "`backend/src/llm/llmClient.ts`", "`backend/src/utils/`", the error part of "`backend/src/extraction/`", and the `llm` and `utils/config` rows of "Tests" in `../plan.md`. Smoke test findings in `../decisions.md` ("Model access"). A working reference for the LangChain calls is the owner's throwaway `local-cvs/smoke/smoke.ts` (gitignored; read it, don't copy it into the repo wholesale).

## What to build

1. **Dependencies** (`backend/package.json`): `@langchain/openai`, `@langchain/core`, and the OpenInference LangChain instrumentation plus the OpenTelemetry pieces needed to export OTLP to Phoenix. Check current package names and setup with Context7 (Arize Phoenix / OpenInference JS docs). The smoke test used `@langchain/openai` 1.6.2 and `@langchain/core` 1.2.18.
2. **Config** (`utils/config.ts`): add `OPENAI_API_KEY` (required), `OPENAI_BASE_URL` (optional URL), `LLM_MODEL` (default `qwen3:14b`), `LLM_CONTEXT_TOKENS` (16384), `LLM_TIMEOUT_MS` (180000), `TRACE_CONTENT` (boolean from `"true"`/`"false"`, default `false`), `PHOENIX_COLLECTOR_ENDPOINT` and `PHOENIX_PROJECT_NAME` (optional), `NODE_ENV`. Expose them as `config.llm` and `config.tracing`. Refuse to start when `NODE_ENV=production` and `TRACE_CONTENT=true`, with a message pointing to `docs/adr/0006-trace-content-is-outside-run-deletion.md`. Existing tests that build a config need the new required key.
3. **`llm/llmClient.ts`:** the `LlmClient` interface, `LlmMessage`, `LlmSchemaError` (with `issues: string[]` as readable `path: message` lines) and `LlmUnavailableError`, exactly as in the plan.
4. **`llm/langChainLlmClient.ts`** (or in the same file if small): `LangChainLlmClient implements LlmClient`:
   - `ChatOpenAI` with `apiKey`, `configuration: { baseURL }`, `model`, `temperature: 0`, `modelKwargs: { reasoning_effort: "none" }` (LangChain's `reasoning` option is dropped for non-OpenAI model names; the smoke test proved `modelKwargs` reaches Ollama and turns thinking off), `timeout`, `maxRetries: 0`.
   - `.withStructuredOutput(schema, { method: "jsonSchema", strict: true, name, includeRaw: true })`; validate the parsed output with `schema.safeParse` and throw `LlmSchemaError` on failure (also when LangChain's own parsing fails).
   - Network errors, timeouts and HTTP errors become `LlmUnavailableError` (keep the cause).
5. **Context guard** (`llm/contextGuard.ts`): a pure function, for example `assertFitsContext(messages, { contextTokens, outputReserve = 4096 })`, estimating tokens as `ceil(characters / 3)`. Over budget throws `LlmUnavailableError` with both numbers in the message. `LangChainLlmClient` calls it before every request.
6. **Extraction errors** (`extraction/errors.ts`): `ExtractionError` (with `issues: string[]`) and `NoRequirementsError`. Created here so tickets 04 and 05 can run in parallel.
7. **Tracing** (`utils/tracing.ts`): `setupTracing(config)` registers OpenInference's LangChain instrumentation and an OTLP exporter to `PHOENIX_COLLECTOR_ENDPOINT` with the project name; when `TRACE_CONTENT` is false, hide inputs and outputs (OpenInference's trace config). No endpoint means no tracing. Call it at the top of `index.ts`, before anything imports LangChain (check the instrumentation's docs for how it must be loaded relative to `@langchain/core`). Never called in tests.
8. **Fake** (`backend/test/fakes/fakeLlmClient.ts`): `FakeLlmClient implements LlmClient` with a queue of responses per call `name` (a value to return, or an error to throw), recording every call's `name` and `messages`. Throws a clear error when a queue is empty.

## Tests
- `test/llm/contextGuard.test.ts`: just under and just over the budget.
- `test/llm/langChainLlmClient.test.ts`: error mapping without a network, by injecting a stub model or a custom `fetch` that returns a 400 / throws / returns invalid JSON. No test calls Ollama.
- `test/utils/config.test.ts`: new defaults; the production guard; missing `OPENAI_API_KEY` throws.

## Acceptance
- `pnpm typecheck` passes; the full backend suite passes (this ticket runs alone unless 02 is still going, in which case run `test/llm test/utils` and the full suite after merging).
- Only `llm/` and `utils/tracing.ts` import `@langchain/*` or OpenInference.
- `.env.example` is not changed here (ticket 07).
