# 04 Job Profile extraction

**Goal:** turn Job Description text into a validated `JobProfile` with Requirement IDs, retrying once with feedback on invalid output.

**Waits for:** 03. Runs in parallel with 05.

**Plan sections:** `extractJobProfile.ts` under "`backend/src/extraction/`" and its row in "Tests" in `../plan.md`. Background: "Validation and retries" and "IDs" in `../decisions.md`.

## What to build

`backend/src/extraction/extractJobProfile.ts`, exporting:
- `extractJobProfile(llm: LlmClient, jobDescriptionText: string): Promise<JobProfile>`.
- `assignJobProfileIds(extracted: ExtractedJobProfile): JobProfile`: Requirements get `req1`, `req2`, ... in order, parsed through `JobProfileSchema` (branded IDs are parsed, not cast). Keep it in this file; `assignIds.ts` belongs to ticket 05.

Behaviour:
1. Messages: a system prompt and the Job Description as the user message. The prompt says:
   - Extract the job title and company (null when absent).
   - Split the requirements so each Requirement is a single skill, qualification or responsibility.
   - `source` quotes only the line or sentence the Requirement came from, verbatim, never the whole list. The smoke test showed the model copying the whole requirements block into every `source`.
   - Importance: `must_have` for required or expected items, `nice_to_have` only for preferred or bonus items, `must_have` when unlabeled.
   - Kind: one of the schema's kinds.
2. `llm.structured(ExtractedJobProfileSchema, messages, { name: "extract_job_profile" })`.
3. On `LlmSchemaError`: retry once with the same messages plus a user message listing the issues and asking for a corrected answer that follows the schema. A second `LlmSchemaError` throws `ExtractionError` with the issues.
4. `LlmUnavailableError` is not retried; let it propagate.
5. A valid result with zero Requirements throws `NoRequirementsError`, with no retry.
6. Return `assignJobProfileIds(result)`.

Keep the prompt text in a named constant at the top of the file, so it is easy to tune.

## Tests (`backend/test/extraction/extractJobProfile.test.ts`, with `FakeLlmClient`)
- Valid on the first try: IDs `req1..reqN`, one call made.
- `LlmSchemaError` then valid: two calls; the second call's messages contain the issues.
- Two `LlmSchemaError`s: `ExtractionError` with the issues.
- Zero Requirements: `NoRequirementsError`, one call only.
- `LlmUnavailableError`: propagates, one call only.

## Acceptance
- `pnpm typecheck` passes; `pnpm --filter backend test test/extraction` passes.
- Touches only `extractJobProfile.ts` and its test.
