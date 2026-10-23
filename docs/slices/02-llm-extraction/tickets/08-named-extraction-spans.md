# 08 Named extraction spans and their attributes

Found in the manual API run (step 4 of the plan's manual checks): tracing works under ESM, but Phoenix shows each extraction as two unrelated root spans with LangChain's generic names (`RunnableSequence` for the model call, `StructuredOutputParser` as a separate root). The plan promises spans named `extract_job_profile` and `extract_cv` (decisions.md, "LlmClient"), carrying a retry count, a failure reason and `soft_mismatches` for the CV (plan.md, `utils/`). Neither exists. The `name` passed to `LlmClient.structured` only names the JSON schema sent to the model.

## Goal

One parent span per extraction, named `extract_job_profile` or `extract_cv`, covering the whole extraction including its retry. Every LangChain span of that extraction (model calls of both attempts, the parser) nests under it. The span carries the attributes below.

## Design

- New file `backend/src/utils/spans.ts`. It imports only `@opentelemetry/api` (no LangChain, no SDK), so `extraction/` may import it without breaking the "only `llm/` imports LangChain" rule. Do not put this in `utils/tracing.ts`, which imports LangChain.
- It exports one helper, roughly `withSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T>`, using `trace.getTracer("resume-ai").startActiveSpan`. It:
  - sets `openinference.span.kind` to `CHAIN` (constant from `@arizeai/openinference-semantic-conventions` is fine; it has no LangChain dependency),
  - on success sets status OK and ends the span,
  - on a throw sets status ERROR, sets `extraction.failure_reason` to the error's `name` (for example `ExtractionError`, `NoRequirementsError`, `LlmUnavailableError`), ends the span and rethrows.
- **No content on the span**: never record error messages, issue lines, prompts or CV text on it (ADR 0006: content is controlled only by `TRACE_CONTENT`, which applies to LangChain's spans). So no `recordException`, and the status carries no message, only the code.
- With no tracer provider registered (tests, or no `PHOENIX_COLLECTOR_ENDPOINT`), `@opentelemetry/api` is a no-op, so nothing else changes.
- `extractJobProfile` and `extractCv` wrap their whole body in `withSpan`. Attributes:
  - `extraction.retries`: `0` or `1`, set before returning or throwing.
  - `extraction.soft_mismatches`: the count, on `extract_cv` only, on success.
  - `extraction.failure_reason`: set by `withSpan` on a throw.
- Nesting relies on `NodeTracerProvider.register()` installing the async-local-storage context manager and on the OpenInference LangChain tracer using `context.active()` as the parent of a LangChain root run. Verify both by reading the installed sources in `node_modules` (`@arizeai/openinference-instrumentation-langchain` and `@opentelemetry/sdk-trace-node`) and state in your report what you found. If the LangChain tracer does not use the active context, stop and report instead of working around it.

## Tests (test-first)

`backend/test/extraction/spans.test.ts` (or extend the two extraction test files), using an in-memory exporter. Add `@opentelemetry/sdk-trace-base` as a devDependency if `InMemorySpanExporter` is not reachable otherwise, with `BasicTracerProvider` and `AsyncLocalStorageContextManager` (or `NodeTracerProvider`) registered in `beforeAll` and the global API reset with `trace.disable()` / `context.disable()` in `afterAll`. Use `FakeLlmClient`.

1. Successful Job Profile extraction makes one span `extract_job_profile` with `extraction.retries = 0`, kind `CHAIN`, status OK.
2. A Job Profile schema failure followed by success makes one span with `extraction.retries = 1`.
3. `NoRequirementsError` makes a span with status ERROR and `extraction.failure_reason = "NoRequirementsError"`, and the error is still thrown.
4. Successful CV extraction makes one span `extract_cv` with `extraction.soft_mismatches` equal to the returned count.
5. A CV failing both attempts makes one span with `extraction.retries = 1`, status ERROR, `failure_reason = "ExtractionError"`, and no attribute or status message containing any issue text.
6. A span started inside `fn` (via `trace.getTracer("x").startActiveSpan`) is a child of the extraction span. This stands in for LangChain's spans.

## Files you own

`backend/src/utils/spans.ts`, `backend/src/extraction/extractJobProfile.ts`, `backend/src/extraction/extractCv.ts`, the new test file (and the two extraction test files if you extend them), `backend/package.json` and `pnpm-lock.yaml` (devDependency only).

## Follow-up found in the manual check (08b)

The first manual run after `02d15fa` showed both named roots, but the CV's `RunnableSequence` (the model call) nested under `extract_job_profile`, in the wrong trace.

- Cause: LangChain runs callback handlers in the background by default. `@langchain/core` `dist/callbacks/base.js:65` sets `awaitHandlers` only when `LANGCHAIN_CALLBACKS_BACKGROUND === "false"`. Otherwise `consumeCallback` (`dist/singletons/callbacks.js`) pushes each handler call onto one global `p-queue` with concurrency 1.
- Queued tasks run in the async context of whatever drained the queue. The job profile's late `handleChainEnd` was still queued when the CV call started, so the CV's `handleChainStart` saw the job profile span as `context.active()`.
- Fix: `setupTracing` sets `process.env.LANGCHAIN_CALLBACKS_BACKGROUND = "false"` when tracing is on. OpenInference builds a new `LangChainTracer` per call (`instrumentationUtils.js`), and the handler reads the variable in its constructor, so setting it at startup is enough. Inline handlers cost nothing noticeable next to a 60 s model call.
- Regression test: run two `LangChainLlmClient.structured` calls back to back (fake `fetch`), each inside its own `withSpan`, with the LangChain instrumentation registered on an in-memory exporter. Assert that each `ChatOpenAI` span shares its trace with its own `withSpan` root. The test must fail with the variable unset.

## Done when

- `pnpm typecheck` passes and `pnpm --filter backend test` is green (Postgres must be up: `docker compose up -d postgres`).
- One commit on `feat/slice-2-llm-extraction`, message ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- The manual check is done by the owner: one `POST /runs` against Ollama, then Phoenix shows `extract_job_profile` and `extract_cv` as root spans with the LangChain spans nested under them and the attributes visible.
