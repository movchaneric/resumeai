# Slice 2 review: LLM extraction

Scope: `git diff master...feat/slice-2-llm-extraction` (42 commits, up to `4ded3dd`, now `3c2a0bd` after the history rewrite), checked against `plan.md`, `decisions.md`, tickets 01 to 08, ADRs 0003, 0004 and 0006, and the root `CLAUDE.md`.

## Summary

The slice does what the plan promises. Reading order, both chains, one retry with fed-back issues, verbatim and month checks, ID assignment, the context guard, the stored Run state, background extraction that never throws, named spans and the production guard on `TRACE_CONTENT` are all in place and tested. Layering is clean: only stores import Prisma, `extraction/` reaches the model only through `LlmClient`, and every `src` import uses `@/` with `.js`.

There is one must-fix. With `TRACE_CONTENT=false`, LangChain error spans still record model output text, so ADR 0006's promise is not kept, and no test checks that content is hidden. The other findings are small. Apart from ticket 08, the main promises that slipped are the handoff (with the measured `LLM_TIMEOUT_MS`) and flushing traces on shutdown.

Already-known open items are not repeated here.

## Must fix before PR

**1. `TRACE_CONTENT=false` still lets model output reach Phoenix through LangChain error spans.**
- Where: `backend/src/utils/tracing.ts:36-39`, which relies only on `hideInputs`/`hideOutputs`.
- What is wrong: the OpenInference tracer calls `span.recordException(run.error)` and `setStatus({ message: run.error })` on every failed LangChain run (`@arizeai/openinference-instrumentation-langchain` `dist/esm/tracer.js:74-79`). `OISpan` passes both through without masking (`@arizeai/openinference-core` `trace-config/OISpan.js:29-44`); masking applies only to attributes. `run.error` is `message + stack` (`@langchain/core` `tracers/base.js:51-52`).
- How content gets in: output that is not valid JSON throws a `SyntaxError` from the OpenAI SDK's zod `$parseRaw`, and V8 quotes the output in its message. Verified: `Unexpected token 'J', "Jane Doe S"... is not valid JSON`. LangChain's own `StructuredOutputParser` goes further and puts the whole model output in its message: `Failed to parse. Text: "<output>"` (`@langchain/core` `output_parsers/structured.js:77`).
- Why it matters: ADR 0006 and the `setupTracing` doc comment promise that, without content, traces keep only timings, counts, retries and failure reasons. This is exactly the failure path that tuning hits, and it is the path production would hit.
- Missing test: nothing checks that `traceContent: false` hides content. `test/utils/tracing.test.ts` only runs with `true`.
- Fix: when `traceContent` is false, wrap the exporter or span processor in `setupTracing` so it drops `exception` events and clears status messages. Add a test in `tracing.test.ts` that calls `instrumentLangChain(provider, false)` with a fake fetch returning invalid JSON, then asserts that no span attribute, event or status contains the output.

## Should fix (small)

**2. CVs with two-digit years can never pass the verbatim check.**
- Where: `backend/src/extraction/verbatim.ts:62-67`.
- What is wrong: the year check needs the four-digit year in the source. A CV written `03/21 – 06/23` or `Mar '21` always fails it. After the retry, the Run either fails with `EXTRACTION_FAILED` or the model blanks the dates to get past the check.
- Why it matters: it is a common CV format, and both outcomes are wrong.
- Fix: also accept the year when its two-digit form appears with a month or an apostrophe (`03/21`, `'21`). If you would rather keep the check strict, record the limit in `decisions.md`.

**3. The month proof misses common forms.**
- Where: `backend/src/extraction/verbatim.ts:38-42`.
- What is wrong: the month-name form allows only `.`, `,` and spaces before the year, so `Jun-2017` and `Jun/2017` are not proven. Year-first names (`2017 Jun`) are not recognised either, although `decisions.md` says "the same with the year first or last".
- Why it matters: the retry tells the model to write the year alone, so a real month is silently dropped.
- Fix: allow `[/.-]` between the name and the year, add a `year sep name` form, and add both to the `it.each` list in `verbatim.test.ts:145`.

**4. Buffered spans are lost on shutdown.**
- Where: `backend/src/index.ts:11` and `19-23`.
- What is wrong: `setupTracing` returns the provider so it can be flushed ("so a caller can flush it on shutdown", `tracing.ts:15`). `index.ts` drops the return value, and the SIGINT/SIGTERM handler calls `process.exit` without `provider.shutdown()`.
- Why it matters: `BatchSpanProcessor` loses the last spans. Those are usually the ones from the extraction you stopped the server to look at.
- Fix: keep the provider and `await provider?.shutdown()` before `prisma.$disconnect()`.

**5. `CLAUDE.md` and the plan disagree with the code on who may import LangChain.**
- Where: `CLAUDE.md:25-26`, `plan.md:59` and `plan.md:96`.
- What is wrong: `CLAUDE.md` says "Only `llm/` imports LangChain" and that `extraction/` "imports only `LlmClient`". In fact `utils/tracing.ts:3` imports `@langchain/core/callbacks/manager`, which ticket 03 allowed, and `extraction/` imports `@/utils/spans.js`. Also, `index.ts` cannot call `setupTracing` "before anything imports LangChain": ESM hoists the import of `langChainLlmClient.js`. It works only because the instrumentation is applied manually.
- Why it matters: the next agent will either "fix" correct code or copy the wrong rule.
- Fix: update `CLAUDE.md` (`utils/tracing.ts` is the one exception; `utils/spans.ts` imports only the OTel API) and correct the sentence in `plan.md:96`.

**6. A test probably quotes a line from the owner's real CV.**
- Where: `backend/test/extraction/verbatim.test.ts:124-161`.
- What is wrong: a line with a job title, an employer and `2024- Present` is labelled "the real CV case". I did not open `local-cvs/` to confirm. (Quoted text removed from this review before commit; it was the owner's real title and `<employer>`.)
- Why it matters: the tickets' rule is "No real CV in git". An employer, title and start year identify the owner.
- Fix: replace it with a fictional company and title. If the owner is fine keeping it, say so in the handoff.

**7. Important paths have no tests.**
- Where: `backend/src/services/runs.ts:29-31`, `backend/src/llm/langChainLlmClient.ts:64-71` and `backend/src/llm/langChainLlmClient.ts:74-77`.
- What is missing:
  - The production `defaultRunInBackground`. Every test injects its own, so nothing proves that a rejection is caught.
  - Mapping a timeout (the OpenAI SDK's `APIConnectionTimeoutError`) to `LlmUnavailableError`. The plan sends this case to `INTERNAL` with no retry.
  - The `parsed == null` / `parsingError` branch.
- Fix: one service test that uses the default runner with a store that throws, one client test whose fetch never resolves with a tiny `timeoutMs`, and one client test for the null branch.

**8. The handoff has not been written.**
- Where: `docs/slices/02-llm-extraction/` (no `handoff.md`).
- What is promised:
  - `decisions.md:34` says "`.env.example` and the handoff document" the Ollama settings.
  - `decisions.md:35` and plan manual check 3 say to set `LLM_TIMEOUT_MS` from measured timings. It is still the 180000 placeholder in `config.ts:19` and `.env.example`, and nothing records a measurement.
- Fix: write the handoff before the PR, with the Ollama command, measured call times, the chosen timeout, the manual-check results and the open items.

**9. A comment states the opposite of a known issue.**
- Where: `backend/src/services/runs.ts:98`.
- What is wrong: it says "the error messages never carry the CV text". In fact `ExtractionError.issues` quote CV values (the known failure-log item), and `LlmSchemaError` issues can carry the JSON snippet from finding 1.
- Why it matters: the comment makes the known item look solved.
- Fix: reword it to "issues may quote CV values; see the known open item", or log only `error.name` and the issue count.

## Follow-up (later slice)

**10. Nothing limits concurrent extraction across Runs.**
- Where: `backend/src/services/runs.ts:29-31` and `78`.
- What is wrong: each `POST /runs` starts its own pair of model calls at once. Ollama on 16 GB queues them (or runs them in parallel at 16k context each, if `OLLAMA_NUM_PARALLEL` is above 1), and time spent in the queue counts toward `LLM_TIMEOUT_MS`.
- Why it matters: a few uploads in a row turn later Runs into `INTERNAL`. `decisions.md` keeps the chains sequential for exactly this memory reason, but only within one Run.
- Fix: a concurrency-1 queue in `defaultRunInBackground` now, or a limit in slice 4's graph runner.

**11. The fixed 4096-token output reserve may be too small for a long CV (unsure).**
- Where: `backend/src/llm/contextGuard.ts:3`.
- What is wrong: CV extraction copies the CV verbatim into JSON, so the output is about as large as the input plus the keys. A 5-page or 30k-character CV can need well over 4096 output tokens. The guard would pass it, and Ollama would truncate or shift the context. This is separate from the known item about the configured window not matching Ollama's real one.
- Fix: measure with the dev script on a 3- to 5-page CV. If the output exceeds the reserve, size it from the input (for example 1.3 × the CV tokens) for `extract_cv`.

**12. Nothing links a Run's two extraction spans.**
- Where: `backend/src/services/runs.ts:92-93` and `backend/src/utils/spans.ts:11`.
- What is wrong: `extract_job_profile` and `extract_cv` are separate root traces with no Run ID, so Phoenix cannot group them per Run.
- Fix: pass attributes into `withSpan` and set a `run.id` attribute (an opaque UUID, not content), or open a parent `extract_run` span. Slice 4's graph may make this unnecessary.

**13. Issue paths are written two different ways.**
- Where: `backend/src/llm/langChainLlmClient.ts:17` and `25`, compared with `backend/src/extraction/assignIds.ts:49-53`.
- What is wrong: `LlmSchemaError` writes paths as `experience.1.company`, while the verbatim and `assignCvIds` issues use `experience[1].company`. Both reach the model in the same retry message.
- Fix: share one `formatPath` helper.

## Spec check

Every plan section and ticket item was traced to code. Apart from items 4, 5 and 8 above, the promises that could slip the way ticket 08 did are met. That includes the failure table and its messages, the step derivation, the Job Description check moved into the service, one `RunsDeps`, the encrypted-PDF and timeout fixtures, the `--check` shape, the `.env.example` contents, the Postman updates, span names and attributes, and the production guard with its ADR reference. Plan manual checks 1, 2 and 4 are the owner's job and cannot be verified from the code.

## Test and typecheck results

- `pnpm typecheck`: passes for `backend` and `shared`.
- `pnpm --filter backend test`: 14 files, 127 tests, all pass (Postgres on 15432).
- `pnpm --filter @resume-ai/shared test`: 1 file, 27 tests, all pass.
