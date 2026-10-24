# 10 Review fixes

From [`../review.md`](../review.md). The owner chose: P5, P2, S2, S3, S4 and S5 in code (this ticket); S1 and P1 are docs, done separately; P3, P4 and S6 to S10 stay as they are.

## P5. Section IDs are not Evidence
`scoring/coverageRules.ts`, `collectItemIds`: stop adding each additional section's own ID (`secN`); keep its items (`secN.iM`). The model never sees `secN` (`renderCv` prints only item lines), so citing it can't be legitimate. Update the doc comment. Test: a verdict citing `sec1` gives the issue `reqN: Evidence ID sec1 does not exist in the CV`, and `sec1.i1` is still accepted.

## P2. `.env.example` Ollama block
Replace the commented `# LLM_COVERAGE_MODEL=` line so that uncommenting the block never sets an empty value. Use one comment line: `# LLM_COVERAGE_MODEL is left unset here: Coverage then uses LLM_MODEL.` No code change.

## S2. Services use only `withSpan`
`utils/spans.ts`: add `withSessionSpan<T>(name: string, sessionId: string, fn: (span: Span) => Promise<T>)`, which calls `withSpan(name, fn, { attributes: { [SemanticConventions.SESSION_ID]: sessionId } })`, with a doc comment ("a root span for one stretch of a Run; Phoenix groups a Run's traces by session.id").
`services/runs.ts`: remove `withPipelineSpan` and the direct imports of `@opentelemetry/api` and `@arizeai/openinference-semantic-conventions`, and call `withSessionSpan("pipeline", id, …)`. If the callback needs the span type, import `Span` as a type from `@/utils/spans.js`, re-exported there. The existing pipeline span test must still pass unchanged.

## S3. Use the shared step state type
`services/runs.ts`, `toRunView`: replace the local `type State = …` with the shared `StepState` type (export it from `shared/src/run-view.ts` if it isn't exported; rebuild shared).

## S4. Derive the failure message keys
`services/runs.ts`: type `FAILURE_MESSAGES` as `Record<Extract<RunErrorCode, "EXTRACTION_FAILED" | "NO_REQUIREMENTS" | "COVERAGE_FAILED" | "INTERNAL">, string>`, or derive the key union from what `failureCode` returns. The point is one source for the codes, so a new code only needs edits where it is produced. Keep the messages byte-for-byte.

## S5. One source for the verdict names
`scoring/assessCoverage.ts`: use `CoverageVerdictSchema` (or its `.options`) for the model schema's `verdict` field and for the attribute loop, instead of repeating the three literals. The model's JSON schema must stay the same; check that `CoverageAnswerSchema` still satisfies `CoverageAnswer`.

## Files you own
`backend/src/scoring/coverageRules.ts`, `backend/src/scoring/assessCoverage.ts`, `backend/src/utils/spans.ts`, `backend/src/services/runs.ts`, `shared/src/run-view.ts` (export only, if needed), `.env.example`, and the tests for these. Do not touch `CLAUDE.md` or `docs/`.

## Done when
`pnpm typecheck` and the full `pnpm --filter backend test` pass (Postgres up), plus `pnpm --filter @resume-ai/shared test` if shared changed. Commits: one for P5 (test-first), one for P2, one for S2, one for S3 to S5. Each ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
