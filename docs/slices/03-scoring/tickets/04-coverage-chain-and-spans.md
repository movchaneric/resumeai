# 04 Coverage chain and span attributes

Plan: "`backend/src/scoring/`" (`assessCoverage.ts`) and "`backend/src/utils/spans.ts`". Decisions: "Coverage chain", "Coverage rules", "Tracing".

Needs ticket 02 merged.

## `utils/spans.ts`
- Signature: `withSpan<T>(name, fn, options?: { attributes?: Attributes })`. Pass the attributes to `startActiveSpan`'s options, so they exist from the start.
- Rename the error attribute `extraction.failure_reason` to `failure_reason`. Update the doc comment and the existing assertions in `test/extraction/spans.test.ts`.

## `scoring/assessCoverage.ts`
- `assessCoverage(llm: LlmClient, cv: Cv, requirements: Requirement[]): Promise<{ coverage: Coverage[]; downgrades: number }>`.
- The model schema, a Zod object matching ticket 02's `CoverageAnswer`: `verdicts` array of `{ requirementId, reason, evidenceIds, verdict }`, **declared in exactly that order**. Use plain strings (no brands, no regex) so the JSON schema stays simple for strict mode. Add `.describe()` texts: reason "1 to 2 sentences, written before deciding", evidenceIds "Item IDs exactly as shown in brackets".
- System prompt (export it as a constant, like `JOB_PROFILE_SYSTEM_PROMPT`). It states:
  - Judge only the listed Requirements, exactly one verdict each.
  - Cite Item IDs exactly as shown.
  - `met` needs an Item that shows the Requirement in use (a job, a bullet, a project, education, a certification or an entry in another section). The skills list or summary alone is at most `partially_met`, except for language Requirements.
  - A duration ("3+ years") is `met` only when the dates of the cited Items prove it. A bare year cannot prove a duration, so use `partially_met` and say so.
  - `unmet` cites no Evidence. `met` and `partially_met` cite at least one Item.
  - Never assume experience the CV doesn't show.
- User message: `Requirements:\n<renderRequirements>\n\nCV:\n<renderCv>`.
- Flow, inside `withSpan("assess_coverage", …)`:
  1. Call with `{ name: "assess_coverage" }`, and set `coverage.retries` to 0.
  2. If the call throws `LlmSchemaError`, or `coverageIssues` returns issues: set `coverage.retries` to 1 and retry once. The retry adds a user message listing the issues, following the extraction retry pattern.
  3. If the retry fails the same way, throw `CoverageError("The model did not return a valid coverage assessment", issues)`.
  4. Never retry `LlmUnavailableError`; rethrow it as is.
  5. `applyClaimRule`, then set `coverage.downgrades` and the three verdict counts.
- No content on the span: no reasons, no Requirement text.

## Tests (test-first)
- `test/scoring/assessCoverage.test.ts` with `FakeLlmClient` (`assess_coverage`): the plan's cases for this area.
- Spans (extend `test/extraction/spans.test.ts`, or add `test/scoring/spans.test.ts` with the same in-memory setup):
  - `assess_coverage` has the retries, downgrades and counts attributes
  - a `CoverageError` gives status ERROR and `failure_reason = "CoverageError"`, with no issue text anywhere on the span
  - `withSpan` attributes passed in are on the span

## Done when
`pnpm typecheck` passes, and `pnpm --filter backend test test/scoring test/extraction` passes. Commits: spans change and rename, then the Coverage chain.
