# 01 Cleanup and error codes

**Goal:** clear the slice 1 review leftovers that slice 2 touches, fix the date regex for Ollama, and rename the error codes, so later tickets build on clean types.

**Waits for:** nothing. Runs in parallel with 02.

## What to build

1. **Date regex** (`shared/src/common.ts`): `PartialDateSchema` regex becomes `^[0-9]{4}(-(0[1-9]|1[0-2]))?$`. Add a comment: Ollama's JSON-schema-to-grammar converter rejects `\d` (`400 failed to parse grammar`) and requires the `^` and `$` anchors; see `docs/slices/02-llm-extraction/decisions.md`. Add a shared test that `z.toJSONSchema(PartialDateSchema)` contains no `\d`.
2. **Error codes** (`shared/src/run-view.ts`, `backend/src/utils/errors.ts`):
   - Rename `EXTRACTION_FAILED` to `UNREADABLE_FILE` (HTTP 422) for parse failures.
   - Add `EXTRACTION_FAILED` (model failure) and `NO_REQUIREMENTS`. They are Run failures, never HTTP responses, but `STATUS` is keyed by every code, so give them 422.
   - Update the three uses in `backend/src/parsing/parseCv.ts` (lines with `new ApiError("EXTRACTION_FAILED", ...)`) to `UNREADABLE_FILE`. Change nothing else in that file: ticket 02 rewrites `parsePdf` in parallel.
   - Update `backend/test/parsing/parseCv.test.ts` line that expects `EXTRACTION_FAILED` for `cv-corrupt.pdf` (one line only), `backend/test/routes/runs.test.ts`, and the Postman test in `postman/resume-ai.postman_collection.json` (the `422 EXTRACTION_FAILED` test name and assertion).
3. **`StoredRun.status`** (`backend/src/stores/runs.ts`): type it as `RunStatus` from `@resume-ai/shared` instead of `string`. Do not add columns; that is ticket 06.
4. **One `Deps` type:** it is defined in `app.ts`, `routes/index.ts` and `services/runs.ts`. Export it once from `services/runs.ts` (as `RunsDeps` or similar) and import it in the other two.
5. **Job Description check in one place:** the controller (`controllers/runs.ts`) currently turns a missing field into `""` and the service rejects it. Make the controller pass the raw value (`unknown`) through, and let the service own the whole check: not a string or blank gives `BAD_REQUEST`, too long gives `JOB_DESCRIPTION_TOO_LONG`. Cover it in `backend/test/services/runs.test.ts`.

## Acceptance
- `pnpm typecheck` passes.
- `pnpm --filter shared test` passes.
- During the wave: `pnpm --filter backend test test/services test/utils` passes. After merging with 02: the full backend suite passes.
- No behaviour change except the renamed code.
- One commit per numbered item above.
