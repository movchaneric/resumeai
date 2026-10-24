# 05 Pipeline: extraction then Coverage, under one traced root

Plan: "`backend/src/services/runs.ts`", "Postman". Decisions: "Pipeline", "Tracing".

Needs tickets 03 and 04 merged.

## Changes
- `services/runs.ts`:
  - Rename `extractRun` to `runPipeline` (update `createRun`, tests and the dev docs that name it).
  - Wrap the work in `withSpan("pipeline", fn, { attributes: { [SemanticConventions.SESSION_ID]: id } })`. Import `SemanticConventions` from `@arizeai/openinference-semantic-conventions`, which `utils/spans.ts` already uses; it has no LangChain dependency.
  - Order: get the Run; `extractJobProfile`; `extractCv`; `store.saveExtraction`; `assessCoverage(llm, cv, jobProfile.requirements)`; `store.saveCoverage`; set the span attribute `score` to the unrounded `matchScore`.
  - `failureCode`: `CoverageError` maps to `COVERAGE_FAILED`. Keep the safe failure log as it is; `CoverageError.issues` gives the count.
  - Keep the method's promise: it never throws.
  - Update the doc comment.
- Postman: the request that polls a Run now waits for `status` `scored` or `failed`, and its tests check that `score` is a number and `requirements` is non-empty when `scored`. Keep the collection's working-directory note.

## Tests (test-first)
- `test/services/runs.test.ts` (fake store, `FakeLlmClient`):
  - success saves the extraction, then the coverage, and ends `scored`
  - a Coverage schema failure twice gives `COVERAGE_FAILED`, with the extraction still stored
  - `LlmUnavailableError` during Coverage gives `INTERNAL`
  - nothing escapes the background task
- `test/routes/runs.test.ts`: `POST`, await the background task, then `GET` shows `scored` with `score` and `requirements`; a failing Coverage fake shows `failed` with `coverage: failed`.
- A pipeline span test, with the same in-memory exporter setup as the other span tests. It runs `runPipeline` with fakes and asserts:
  - one root span `pipeline` with `session.id` equal to the Run id and a numeric `score`
  - `extract_job_profile`, `extract_cv` and `assess_coverage` are its children, in the same trace

## Done when
`pnpm typecheck` and the full `pnpm --filter backend test` pass (Postgres up). Commits: the pipeline, then Postman.
