# Slice 2 plan: LLM extraction

The buildable version of [`decisions.md`](./decisions.md), which holds the reasons. Terms follow `CONTEXT.md`. Code rules follow the root `CLAUDE.md` (layers, `@/` imports with `.js`, constructor injection, Sonnet writes all code).

## Goal

After `POST /runs`, the backend extracts the CV and the Job Description into a validated `Cv` and `JobProfile` with stable IDs, using a local model through Ollama, and stores them on the Run. `GET /runs/:id` shows extraction progress, the job title and company, or a clear failure. A dev script runs the same extraction on a local file with no HTTP or database.

## Behaviour seen from outside

### `GET /runs/:id` over a Run's life

| Moment | `status` | `steps` (`parse`, `extract`, others) | `job` | `error` |
|---|---|---|---|---|
| Right after `201` | `extracting` | done, running, pending | null | |
| Extraction succeeded | `extracting` | done, done, pending | `{ title, company }` from the Job Profile | |
| Extraction failed | `failed` | done, done*, pending | null | `{ code, message }` |

\* A failed Run's `extract` step shows `done` because `StepStateSchema` has no `failed` state. The `failed` status and `error` carry the failure. Revisit in slice 6 if the UI needs it.

### Failure codes

| Code | When | Retry first? | Message (user-facing) |
|---|---|---|---|
| `UNREADABLE_FILE` (renamed from `EXTRACTION_FAILED`) | Parsing: corrupt, encrypted or timed-out file. `POST /runs` returns `4xx`, no Run. | n/a | unchanged from slice 1 |
| `EXTRACTION_FAILED` (new meaning) | The model's output fails the schema, the date refinement, the verbatim check, or the empty-CV rule, twice | yes, once per chain | "We couldn't read the structure of your CV or job description. Try again, or upload a DOCX." |
| `NO_REQUIREMENTS` (new) | A valid Job Profile with zero Requirements | no | "We couldn't find any requirements in this job description. Paste the full posting." |
| `INTERNAL` | Model unreachable, a call over `LLM_TIMEOUT_MS`, the prompt over the context budget, or any unexpected error | no | "Something went wrong. Try again." The real cause is logged and traced. |

## Changes by area

### `shared/`
- `PartialDateSchema` regex becomes `^[0-9]{4}(-(0[1-9]|1[0-2]))?$`, with a comment: Ollama's grammar converter rejects `\d`, and the anchors are required.
- `RunErrorCodeSchema`: rename `EXTRACTION_FAILED` to `UNREADABLE_FILE`, then add `EXTRACTION_FAILED` and `NO_REQUIREMENTS`.
- Tests: the existing date tests still pass; add one test that the JSON schema of `PartialDateSchema` contains no `\d`.

### `backend/src/parsing/`
- `parsePdf` builds text from `extractTextItems` (x, y, width, height per item) instead of `extractText`, through a pure function in `parsing/pdfLayout.ts`:
  - Group items into lines by y (with a tolerance for baseline jitter).
  - Inside a line, insert a separator (two spaces or a tab) at gaps much wider than a space, so a date is no longer glued to the next words.
  - Per page, find a column gutter: an x band that no line crosses across most of the page height. If there is one, read the left column top to bottom, then the right. Otherwise read the lines top to bottom.
  - Keep page breaks as blank lines. The scanned-PDF and page-count checks keep working.
- Rename the slice 1 `EXTRACTION_FAILED` uses to `UNREADABLE_FILE`.
- The tolerance and gap thresholds are constants in `pdfLayout.ts`, tuned on the synthetic fixture and checked on the owner's CV with the dev script.

### `backend/src/llm/llmClient.ts`
```ts
export interface LlmClient {
  /** One structured call. Resolves with output that already passed `schema.parse`, or throws. */
  structured<T>(schema: z.ZodType<T>, messages: LlmMessage[], options: { name: string }): Promise<T>;
}
export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };
export class LlmSchemaError extends Error { issues: string[] }   // output did not match the schema
export class LlmUnavailableError extends Error {}               // unreachable, timeout, HTTP error, context budget exceeded
```
- `LangChainLlmClient implements LlmClient`: `ChatOpenAI` with `configuration.baseURL` = `OPENAI_BASE_URL`, `apiKey`, `model` = `LLM_MODEL`, `temperature: 0`, `modelKwargs: { reasoning_effort: "none" }`, `timeout` = `LLM_TIMEOUT_MS`, `maxRetries: 0`. Uses `.withStructuredOutput(schema, { method: "jsonSchema", strict: true, name, includeRaw: true })`.
- The context guard runs before each call: `ceil(total characters / 3) + outputReserve > LLM_CONTEXT_TOKENS` throws `LlmUnavailableError`. `outputReserve` is a constant (4096 tokens); a separate guard function is unit-tested.
- Maps errors: a parse or validation failure on the output becomes `LlmSchemaError` with readable issue paths; network, timeout and HTTP errors become `LlmUnavailableError`.
- Only this folder imports `@langchain/*`.

### `backend/src/extraction/`
- `extractJobProfile.ts`: `extractJobProfile(llm, jobDescriptionText) => Promise<JobProfile>`.
  - Prompt: one Requirement per line or idea; `source` quotes only the line or sentence it came from, verbatim; importance rules as in the schema descriptions.
  - Calls `llm.structured(ExtractedJobProfileSchema, …, { name: "extract_job_profile" })`. On `LlmSchemaError`, retries once with the issues appended as a user message. A second failure throws `ExtractionError`.
  - Zero Requirements throws `NoRequirementsError` (no retry).
  - Assigns IDs with `assignJobProfileIds` (`req1`, `req2`, ...), a small pure function in the same file.
- `extractCv.ts`: `extractCv(llm, cvText) => Promise<Cv>`.
  - Prompt: copy text verbatim; headings guide which section content belongs to; dates as `YYYY` or `YYYY-MM`; `current: true` and `end: null` for "Present"; unknown headings go to `additionalSections` with the candidate's heading as `title`.
  - Calls `llm.structured(ExtractedCvSchema, …, { name: "extract_cv" })`, then runs, in order: `normalizeDateRange` on every range, the empty-CV rule, `checkVerbatim`, then `assignCvIds` (which validates with `CvSchema`, so the refined `DateRangeSchema` runs there).
  - Any failure in that chain (schema, empty CV, verbatim, refinement) collects readable issues; one retry with the issues fed back; a second failure throws `ExtractionError`.
  - Returns the soft mismatch count (bullets, summary, skills not found verbatim) alongside the `Cv` for tracing.
- `assignIds.ts`: pure `assignCvIds(extracted) => Cv`, producing the IDs in `decisions.md` and parsing through `CvSchema` (branded IDs are parsed, not cast). `assignJobProfileIds` lives in `extractJobProfile.ts`, so the two chains never edit the same file.
- `verbatim.ts`: pure `checkVerbatim(cv, sourceText) => { issues: string[]; softMismatches: number }`.
  - Normalize both sides: lowercase, Unicode NFKC, collapse whitespace, remove punctuation except characters inside words.
  - Protected fields (`company`, `title`, `institution`, `degree`, `field`, certification `name`) must be substrings of the normalized source; each miss is an issue such as `experience[1].company "Acme Ltd" not found in the CV text`.
  - The year of every `start` and `end` must appear in the source.
  - Bullets, summary and skills only count toward `softMismatches`.
- Errors: `ExtractionError` (with `issues`) and `NoRequirementsError` in `extraction/errors.ts`, created by ticket 03 so the two chain tickets can run in parallel. They are not `ApiError` because they never reach HTTP.

### `backend/src/services/runs.ts`
- `Deps` gets `llm: LlmClient` and `runInBackground?: (task: () => Promise<void>) => void` (default: call it and attach a `.catch` that logs, so nothing escapes). Tests pass a version that collects the promises so they can await them.
- `createRun` stores the Run as before, then calls `runInBackground(() => this.extractRun(id))`.
- `extractRun(id)`: load the Run, `extractJobProfile`, then `extractCv` (sequential, Job Profile first), then `store.saveExtraction(id, { cv, jobProfile })`. Map `NoRequirementsError` to `NO_REQUIREMENTS`, `ExtractionError` to `EXTRACTION_FAILED`, and anything else to `INTERNAL`, via `store.markFailed(id, code, message)`. Never throws.
- `toRunView` derives status, steps and `job` from the stored Run (table in "Behaviour seen from outside"), instead of hardcoding `extracting`.
- Move the whole Job Description check into the service (the controller passes the raw field through).
- `Deps` is defined once (exported from `services/runs.ts` or a small `app` deps type) and imported by `app.ts` and `routes/index.ts`.

### `backend/src/stores/runs.ts` and Prisma
- Migration adds nullable `cv JSONB`, `job_profile JSONB`, `error_code TEXT`, `error_message TEXT` to `app.runs`. Update the schema comment (transitional, ADR 0003 slice 2 extension).
- `StoredRun.status` becomes `RunStatus`; `StoredRun` gains `cv: Cv | null`, `jobProfile: JobProfile | null`, `error: { code: RunErrorCode; message: string } | null`.
- The store parses `cv` and `job_profile` with `CvSchema` and `JobProfileSchema` on read, so nothing outside it sees raw JSON.
- New methods: `saveExtraction(id, { cv, jobProfile })`, `markFailed(id, code, message)`.

### `backend/src/utils/`
- `config.ts`: `LLM_MODEL` (default `qwen3:14b`), `LLM_CONTEXT_TOKENS` (16384), `LLM_TIMEOUT_MS` (180000), `OPENAI_BASE_URL` (optional), `OPENAI_API_KEY` (required), `TRACE_CONTENT` (boolean, default `false`), `PHOENIX_COLLECTOR_ENDPOINT` and `PHOENIX_PROJECT_NAME` (optional; no endpoint means no tracing), `NODE_ENV`. Refuse to start when `NODE_ENV=production` and `TRACE_CONTENT=true`, with a message naming ADR 0006.
- `tracing.ts`: `setupTracing(config)` registers OpenInference's LangChain instrumentation with an OTLP exporter to Phoenix. `TRACE_CONTENT=false` hides inputs and outputs. Called once from `index.ts`. Not called in tests. (Corrected after the review: under ESM the imports of `index.ts` are hoisted, so LangChain is already loaded when `setupTracing` runs. It works because the instrumentation is applied manually to the `CallbackManager` module, not by import hooks.)
- Extraction spans carry attributes: retry count, failure reason, and `soft_mismatches` for the CV.

### Wiring and scripts
- `index.ts`: set up tracing, build `LangChainLlmClient` from config, pass it to `createApp`.
- `backend/test/extract.ts` (next to `make-fixtures.ts`), script `extract` in `package.json`:
  - `pnpm --filter backend extract <cv-file> <job-description-file>`: parse, print the reconstructed text, run both chains with the real `LangChainLlmClient`, print the `JobProfile`, the `Cv`, the soft mismatch count and the time per call. No HTTP, no database.
  - `--check`: compare against `<cv-file-without-extension>.expected.json` next to the CV. Compare only companies, titles, institutions, degrees, certification names, dates, and counts of jobs and bullets per job. Print a diff, exit non-zero on a mismatch.
- `.env.example`: add the new variables with comments, `TRACE_CONTENT=true`, and the Ollama start command `OLLAMA_CONTEXT_LENGTH=16384 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve`.
- Postman: update the `EXTRACTION_FAILED` expectation for the corrupt PDF to `UNREADABLE_FILE`, and add a request that polls a Run until `extract` is `done` (manual, needs Ollama).

## Tests

No test calls a model. A `FakeLlmClient` in `backend/test/` returns queued responses per call name (an object, or an error to throw) and records the messages it received.

| Area | Cases |
|---|---|
| `parsing/pdfLayout` (pure) | lines grouped by y with jitter; a wide gap becomes a separator; two-column page reads left then right; single-column page reads top to bottom; empty page |
| `parsing/parseCv` | the synthetic two-column PDF fixture comes out in reading order (name before summary, each date on the line of its job); existing cases; corrupt PDF gives `UNREADABLE_FILE`; new encrypted-PDF fixture gives `UNREADABLE_FILE`; parse timeout gives `UNREADABLE_FILE` (with a tiny `parseTimeoutMs`) |
| `extraction/assignIds` | the ID scheme for every section; no ID equals a reserved `SectionId`; IDs are unique; an end-before-start range fails `CvSchema` |
| `extraction/verbatim` | exact and case/whitespace/punctuation variants pass; a changed title fails with a readable issue; a year not in the source fails; a paraphrased bullet only increments `softMismatches` |
| `extraction/extractJobProfile` | valid first try; schema error then valid (the retry message contains the issues); two schema errors give `ExtractionError`; zero Requirements gives `NoRequirementsError` with no retry; IDs `req1…` |
| `extraction/extractCv` | valid first try; verbatim failure then valid; date refinement failure then valid; empty CV twice gives `ExtractionError`; `LlmUnavailableError` is not retried |
| `llm/llmClient` | the context guard (just under and just over the budget); error mapping with a stubbed model (no network) |
| `services/runs` (fake store, fake LLM) | `createRun` schedules extraction; success saves both and the view shows `extract: done` and `job`; each failure maps to its code; an unexpected throw becomes `INTERNAL` and nothing escapes; Job Description validation lives in the service |
| `routes/runs` (supertest, real test DB, fake LLM) | `POST` then awaiting the background task, then `GET` shows the extracted state; a failing fake gives `failed` with the code; slice 1 cases still pass with `UNREADABLE_FILE` |
| `utils/config` | new defaults; `TRACE_CONTENT=true` with `NODE_ENV=production` throws; missing `OPENAI_API_KEY` throws |

Fixtures: `make-fixtures.ts` gains the two-column PDF (fictional person, sidebar with contact and skills, main column with dated jobs) and an encrypted PDF.

## Manual checks (owner, with Ollama running)
1. `pnpm --filter backend extract local-cvs/<cv>.pdf local-cvs/<job>.txt` prints sensible text order, a valid `Cv` and `JobProfile`, and times per call. Watch `ollama ps` for `100% GPU`.
2. Write `local-cvs/<cv>.expected.json` by hand, then `--check` passes.
3. Set `LLM_TIMEOUT_MS` from the measured times (keep at least 2× the slowest call).
4. `pnpm --filter backend dev`, upload through Postman, poll until `extract` is `done`, and find both spans in Phoenix (with content locally).

## Out of scope
Coverage and the Match Score (slice 3); the graph, checkpointer, durability across restarts, and parallel chains (slice 4); deleting Runs and the TTL sweep (slice 5); any frontend (slice 6); tables or three-column PDF layouts; a hosted model.
