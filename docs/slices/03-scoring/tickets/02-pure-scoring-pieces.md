# 02 Pure scoring pieces

Plan: "`backend/src/prompts/renderCv.ts`" and "`backend/src/scoring/`" (all but `assessCoverage.ts`). Decisions: "Coverage rules", "Match Score", "Structure".

## Goal
The pure functions the Coverage chain and the view need, all tested, with no model and no database.

## Files
- `backend/src/prompts/renderCv.ts`: `renderCv(cv: Cv): string` and `renderRequirements(requirements: Requirement[]): string`, as in the plan. Read `shared/src/cv.ts` for every section and field, and `extraction/assignIds.ts` for the ID scheme. Keep the output compact: no blank lines inside a section, one blank line between sections.
- `backend/src/scoring/weights.ts`: the two constant maps from the plan, typed by `Importance` and `CoverageVerdict`, with a comment pointing to ADR 0004.
- `backend/src/scoring/matchScore.ts`: `matchScore(requirements: Requirement[], coverage: Coverage[]): number`, unrounded.
- `backend/src/scoring/coverageRules.ts`:
  - `type CoverageAnswer = { verdicts: { requirementId: string; reason: string; evidenceIds: string[]; verdict: CoverageVerdict }[] }` (export it; ticket 04's model schema must match it)
  - `coverageIssues(requirements, cv, answer): string[]`
  - `applyClaimRule(requirements, answer): { coverage: Coverage[]; downgrades: number }`. It returns `Coverage[]` in Requirement order, with IDs parsed through the shared schemas. Call it only after `coverageIssues` returned no issues.
  - The fixed downgrade reason as an exported constant: `"Listed in the skills or summary, but no experience, project or education Item shows it."`
  - Claims are exactly the IDs `summary` and `skill<N>`. Put that in one named constant or function with a comment that it relies on section-type ID prefixes (slice 2 decisions, "IDs").
  - An Item ID collector over a `Cv`. Search `extraction/` first and reuse one if it exists.
- `backend/src/scoring/errors.ts`: `CoverageError extends Error` with `issues: string[]`, `name = "CoverageError"`, modelled on `extraction/errors.ts`.
- `CLAUDE.md`: in the backend structure block, add `scoring/` ("Coverage chain, Match Score, weights. Imports `LlmClient` and `@/utils/spans.js`, never LangChain.") and `prompts/` ("pure renderers that turn the CV and Requirements into prompt text with IDs"). Add both to the `backend/test/` mirror line.

## Tests (test-first)
`test/prompts/renderCv.test.ts`, `test/scoring/matchScore.test.ts`, `test/scoring/coverageRules.test.ts`. Use the cases in the plan's Tests table for these three areas. Build CVs from made-up data; `test/extraction/cvFixture.ts` may help.

## Done when
`pnpm typecheck` passes, and `pnpm --filter backend test test/prompts test/scoring` passes. One commit per file group (renderer, weights and score, rules and errors, CLAUDE.md).
