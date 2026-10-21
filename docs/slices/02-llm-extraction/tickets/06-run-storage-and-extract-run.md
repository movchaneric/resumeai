# 06 Run storage and extractRun

**Goal:** after `POST /runs`, extraction runs in the background, its result or failure is stored on the Run, and `GET /runs/:id` shows it.

**Waits for:** 01, 04, 05. Runs in parallel with 07.

**Plan sections:** "Behaviour seen from outside", "`backend/src/services/runs.ts`", "`backend/src/stores/runs.ts` and Prisma", "Wiring and scripts" (the `index.ts` and Postman parts) and the `services/runs` and `routes/runs` rows of "Tests" in `../plan.md`. Background: "Storage" and "Trigger and Run lifecycle" in `../decisions.md`; ADR 0003's slice 2 extension.

## What to build

1. **Migration** (`pnpm --filter backend db:migrate`, named for example `add_extraction_results`): nullable `cv JSONB`, `job_profile JSONB`, `error_code TEXT`, `error_message TEXT` on `app.runs`. Update the comment above `model Run`: these are transitional (ADR 0003, slice 2 extension) and are dropped in slice 4.
2. **Store** (`stores/runs.ts`):
   - `StoredRun` gains `cv: Cv | null`, `jobProfile: JobProfile | null`, `error: { code: RunErrorCode; message: string } | null`.
   - Map rows to `StoredRun` in one function that parses `cv` and `job_profile` with `CvSchema` and `JobProfileSchema`, so no raw JSON leaves the store.
   - New methods: `saveExtraction(id, { cv, jobProfile })` and `markFailed(id, code, message)` (sets `status = "failed"`).
3. **Service** (`services/runs.ts`):
   - `Deps` gains `llm: LlmClient` and `runInBackground?: (task: () => Promise<void>) => void`. The default runs the task and attaches a `.catch` that logs, so no rejection escapes.
   - `createRun` stores the Run as now, then `runInBackground(() => this.extractRun(id))`.
   - `extractRun(id)`: load the Run (return quietly if it's gone); `extractJobProfile`, then `extractCv` (sequential, Job Profile first); `saveExtraction`. Map `NoRequirementsError` to `NO_REQUIREMENTS`, `ExtractionError` to `EXTRACTION_FAILED`, and anything else to `INTERNAL`, with the user-facing messages from the plan's failure table; log the real cause. It never throws.
   - `toRunView` derives the view from the stored Run, following the plan's table: `extracting` with no `cv` means `extract: running`; both results present means `extract: done` and `job: { title, company }`; `failed` shows `extract: done` and `error`. It still validates with `RunViewSchema`.
4. **Wiring:** `index.ts` builds `LangChainLlmClient` from config and passes it in; `app.ts` and `routes/index.ts` pass `llm` (and an optional `runInBackground`) through the single `Deps` type from 01.
5. **Postman:** add a request that fetches a Run and shows `steps` and `job`, with a note that it needs Ollama running and may need re-sending until `extract` is `done`.

## Tests
- `test/services/runs.test.ts` (fake store, `FakeLlmClient`, a `runInBackground` that collects promises): `createRun` schedules extraction; success saves both and the view shows `extract: done` and `job`; `NoRequirementsError`, `ExtractionError` and an unexpected error each give `failed` with the right code; nothing escapes.
- `test/routes/runs.test.ts` (supertest, real test DB, `FakeLlmClient`): `POST`, await the collected task, then `GET` shows the extracted state; a failing fake gives `failed` with its code; the slice 1 cases still pass.

## Acceptance
- `pnpm typecheck` passes. During the wave, run `test/services` only; after merging with 07, the full backend suite passes (this ticket owns the route tests that use the shared test DB, so the full run happens at merge).
- The migration applies cleanly to an existing dev database (`pnpm --filter backend db:migrate`).
