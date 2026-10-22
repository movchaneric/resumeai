# Slice 2 decisions: LLM extraction

Settled in a grilling session before implementation. Scope comes from the slice 1 handoff. Terms follow `CONTEXT.md`: **Parsing** is file to text, **Extraction** is text to the structured CV and Job Profile.

## Parsing: PDF reading order
- `unpdf`'s `extractText` returns text in PDF storage order, which jumbles two-column CVs. Rebuild the order in code from `extractTextItems` (x and y positions): group items into lines by y, insert a separator at large x gaps (so a date is no longer glued to the next line), find the column gutter per page, and read each column top to bottom.
- A page with no clear gutter falls back to plain top-to-bottom line order. Tables and three-column layouts are out of scope.
- Rejected: giving the extractor both layouts (doubles tokens, still leaves the model to guess the order) and leaving it to the model (a date range far from its job becomes a silent wrong answer, against ADR 0004).
- DOCX is unchanged: mammoth already returns document order.

## Trigger and Run lifecycle
- Extraction runs as an in-process background task started after `POST /runs` returns `201`. The client polls `GET /runs/:id`. The task catches every error and writes `failed`; no unhandled rejection may escape.
- A server restart mid-extraction leaves the Run at `extracting`. Accepted for local dev; slice 4's checkpointer fixes durability, and the fire-and-forget call becomes "start the graph".
- After success the Run stays at `extracting` with `parse` and `extract` done and `coverage` pending (transitional, like slice 1). `job` in the view is filled from the Job Profile's title and company. No new status is added.
- The Job Profile chain runs first (shorter, fails fast), then the CV chain. Sequential, because Ollama on 16 GB cannot serve two 16k contexts in parallel. Slice 4 may make them parallel graph branches on a hosted model.

## Storage (extends the ADR 0003 addendum)
- `app.runs` gains `cv` and `job_profile` (JSONB, the validated `Cv` and `JobProfile` with IDs, Zod-validated on read) and `error_code` and `error_message`.
- Step state is derived, not stored: `extracting` with `cv` null means `extract` is `running`; both results present means `done`; `failed` reads the error columns.
- Slice 4 drops `cv_text`, `job_description_text`, `cv` and `job_profile`; existing dev Runs are deleted, not migrated. Whether the error columns stay is decided in slice 4.

## Model access
- LangChain JS: `ChatOpenAI` (`@langchain/openai`) pointed at `OPENAI_BASE_URL`, with `.withStructuredOutput(zodSchema)`, `temperature: 0` and thinking off.
- It sits behind our own `LlmClient` interface, roughly `structured(schema, messages, { name })`, where `name` labels the trace span (`extract_cv`, `extract_job_profile`). Only `llm/` imports LangChain; tests use a fake `LlmClient` and never call a model.
- Thinking is turned off with `modelKwargs: { reasoning_effort: "none" }`. LangChain's own `reasoning: { effort }` option is silently dropped for model names it doesn't recognise as OpenAI reasoning models, so it never reaches Ollama.

### Smoke test findings (2026-10-21, Ollama 0.32.14, `qwen3:14b`, `local-cvs/smoke/`)
- **Job Profile:** strict structured output works and passes Zod (6 Requirements, importance split correct). Quality issue for the real prompt: every `source` held the whole requirements block instead of the one line it came from.
- **Thinking off works:** with `reasoning_effort: "none"`, 0 reasoning characters and 58 s, against 1,596 characters and 85 s with the default.
- **Context window:** `ollama ps` shows `CONTEXT 16384` and `SIZE 12 GB`, but `PROCESSOR 7%/93% CPU/GPU`: macOS gives the GPU only 11.8 GB of the 16 GB, so part of the model runs on the CPU.
- **The CV schema was rejected** with `400 failed to parse grammar`. A bisect against raw requests isolated the cause: Ollama's regex converter does not support `\d`. `[0-9]` works; `^` and `$` are required; `$ref`/`$defs` and `title` are fine. The full `ExtractedCvSchema` with `[0-9]` passed Zod and every date came back as `YYYY` or `YYYY-MM` (93 s for a 15-line synthetic CV).
- **The pattern does real work:** without it the model copied `"March 2021"` verbatim despite the prompt; with it, `"2021-03"`. Keep it in the schema sent to the model.
- **Decision:** `PartialDateSchema` uses `[0-9]` instead of `\d` (identical matching in JavaScript), with a comment saying why. Keep LangChain's own Zod-to-JSON-schema conversion. The plain-SDK fallback is not needed: the failure was the schema, not LangChain.
- **Speed:** with `OLLAMA_FLASH_ATTENTION=1` and `OLLAMA_KV_CACHE_TYPE=q8_0` (an 8-bit KV cache, about half the memory), the full CV call dropped from 93 s to 39 s with identical, valid output. Ollama runs with all three settings: `OLLAMA_CONTEXT_LENGTH=16384 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve`. `.env.example` and the handoff document this.
- **Timeout:** `LLM_TIMEOUT_MS` stays at 3 minutes for now. Set the final value from the dev script's timings on the owner's real CV.
- Switching to a hosted provider later: hosted OpenAI is a config change; Anthropic or Gemini need one new `LlmClient` implementation plus an `LLM_PROVIDER` setting added then.

## Validation and retries
- Two stages: the extraction schema, then the refined `DateRangeSchema` after `normalizeDateRange` (ADR 0004). Dates are never "fixed" by our code.
- **Verbatim check** on protected fields: each `company`, `title`, `institution`, `degree`, `field` and certification `name` must appear in the source text (compared ignoring case, collapsed whitespace and punctuation); the year of every `start` and `end` must appear in the source text.
- **Months must be proven too (added after the first real run).** On the owner's CV, `2024- Present` came back as `start: "2024-01"`: the model invented a month despite the prompt, and the year-only check passed it. When an extracted date has a month, the source must show that month next to that year (`Jan 2024`, `January 2024`, `01/2024`, `1/2024`, `2024-01`, `2024/01`, and the same with the year first or last). A miss is an issue like any other protected fact: one retry telling the model to write the year alone when the CV gives no month, then `EXTRACTION_FAILED`. Our code never drops or changes the month itself (ADR 0004). Known limit: only English month names and numeric forms are recognised.
- **Not done: asking the user for a missing month.** A bare year is a complete, valid CV fact; the bug was invention, not absence. Asking would be a new kind of Question (CONTEXT.md limits Questions to unmet must-have Requirements) and needs slice 4's interrupt. Input for slices 3 and 4: when a bare-year date makes a duration Requirement ambiguous ("3+ years"), Coverage leaves it unmet and the existing Question about that Requirement asks for the duration.
- **Empty CV:** a CV with no experience, education, projects or skills is invalid output (likely a broken reading order). An empty summary or no certifications is fine.
- Any failure above triggers **one retry per chain** with the validation errors fed back; a second failure fails the Run with `EXTRACTION_FAILED`.
- Bullet, summary and skill mismatches against the source are not failures; their count is recorded as a trace attribute.
- **Zero Requirements** fails the Run with the new code `NO_REQUIREMENTS` ("We couldn't find any requirements in this job description. Paste the full posting."). No retry: it is the user's input, not a model failure.
- A call that exceeds `LLM_TIMEOUT_MS`, or a model that cannot be reached, fails the Run with `INTERNAL`. No retry on timeout.

## Error codes
- `EXTRACTION_FAILED` (slice 1, "the file could not be read") is renamed `UNREADABLE_FILE`.
- `EXTRACTION_FAILED` now means the model could not produce a valid CV or Job Profile.
- New: `NO_REQUIREMENTS`. Tests and the Postman collection are updated.

## IDs
Short IDs based on position, assigned once at extraction and never recomputed. The prefix comes from the section type, never from the candidate's heading.

| Section | IDs |
|---|---|
| contact, summary | `contact`, `summary` |
| experience | `exp1`, `exp1.b1` |
| education | `edu1`, `edu1.b1` |
| skills | `skill1` |
| projects | `proj1`, `proj1.b1` |
| certifications | `cert1` |
| additional sections | `sec1`, `sec1.i1` (the heading stays in `title`) |
| Requirements | `req1` |

None collide with the reserved `SectionId` values. Items added by tailoring (slice 4) need their own form, for example `exp1.n1`; that is slice 4's decision.

## Context window
- Ollama runs with `OLLAMA_CONTEXT_LENGTH=16384` (documented in `.env.example`). Without it Ollama uses its default of 4096 on this machine (confirmed in its startup log) and silently drops the oldest tokens.
- A guard estimates prompt size (characters ÷ 3) plus an output reserve against `LLM_CONTEXT_TOKENS`, and fails the Run with `INTERNAL` instead of letting the prompt be truncated.
- At 16k the KV cache is about 2.5 GB on top of 9 GB of weights on the owner's 16 GB M1 Pro. The smoke test confirms the real window with `ollama ps`.

## Config
New settings, validated in `ConfigSchema`:
- `LLM_MODEL` (`qwen3:14b`), `LLM_CONTEXT_TOKENS` (16384), `LLM_TIMEOUT_MS` (180000).
- `TRACE_CONTENT` (see Tracing).

`OPENAI_API_KEY` and `OPENAI_BASE_URL` keep their names. Temperature and thinking stay in code: they define how extraction behaves, not where it runs.

## Tracing (ADR 0006)
- Phoenix via OpenInference's LangChain instrumentation, set up in `utils/tracing.ts`. Tests run with tracing off.
- `TRACE_CONTENT` controls whether prompts and outputs are recorded. Its default is `false`; only `.env.example` sets `true` for local work. `loadConfig` refuses to start when `NODE_ENV=production` and `TRACE_CONTENT=true`.

## Structure
```
backend/src/
  llm/          llmClient.ts: LlmClient interface, LangChain implementation, context guard
  extraction/   extractCv.ts, extractJobProfile.ts (chain + prompt + retry), assignIds.ts, verbatim.ts
  parsing/      parseCv.ts + column-aware PDF reading order
  utils/        tracing.ts
  services/     runs.ts gains extractRun(id)
```
`extraction/` imports only `LlmClient`, never LangChain. Tests mirror this under `backend/test/`.

## Quality checks
- **Unit test (normal suite, no model):** a synthetic two-column PDF fixture, generated by the fixture script, checks the reading order.
- **Local answer key (not in git):** next to the owner's CV in `local-cvs/`, a hand-written `<name>.expected.json` with only the protected facts (companies, titles, institutions, degrees, certification names, dates) and counts (jobs, bullets per job). `pnpm --filter backend extract --check <cv>` compares and prints a diff.
- End users never run either; they are developer tools.

## Dev script
`pnpm --filter backend extract <cv-file> <job-description-file>` parses the file with `parseCv`, prints the reconstructed text, runs both chains against the configured model, and prints the `Cv` and `JobProfile` with timings. It uses no HTTP and no database, and calls the same functions as the service. `--check` compares against the answer key.

## Cleanup from slice 1 (one commit each)
- Type `StoredRun.status` as `RunStatus`.
- Define `Deps` in one place, imported by `app.ts` and `routes/index.ts`.
- Move the whole Job Description check into the service.
- Add an encrypted-PDF fixture and a parse-timeout test.

Left open: the fixture script location, `TOO_MANY_PAGES` for long DOCX, the expiry sweep and a killable parse worker.
