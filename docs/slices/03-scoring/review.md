# Slice 3 review: Coverage and the Match Score

Scope: `git diff master...feat/slice-3-scoring` (32 commits, up to `efcdf42`). Two read-only reviewers ran in parallel: **Standards** (root `CLAUDE.md`, `CONTEXT.md`, ADRs 0003, 0004 and 0006, plus a code-smell baseline) and **Spec** (`plan.md`, `decisions.md`, tickets 01 to 09). Opus checked every finding against the code before writing it here.

**Summary.** No hard standards violations and nothing blocks the merge. Every row of the plan's test table has a test. The promises most likely to slip quietly all hold: the five `GET /runs/:id` rows, `COVERAGE_FAILED` and its message, `pipeline` with `session.id` and `score`, the `assess_coverage` attributes, no content on spans or in logs, the Claim rule table, Evidence cleared on unmet, the reasoning-effort and temperature rules, the `LLM_COVERAGE_MODEL` fallback, Postman, and the dev script's warning-only exit code. `pnpm typecheck` passes; backend tests 219/219.

Standards: 1 near-violation (documentation) and 9 judgement calls. Spec: 5 small deviations. The worst on each axis: ADR 0003 doesn't record the slice 3 extension the code cites (Standards); a section ID that the model never sees is accepted as Evidence (Spec).

## Standards

**S1. ADR 0003 has no slice 3 extension, but the code cites one (near-violation, documentation).** `stores/runs.ts:29`, `shared/src/run-view.ts:74` and the Prisma schema comment say "ADR 0003, slice 3 extension", but ADR 0003 records only the slice 1 and slice 2 exceptions. The extension is written only in `decisions.md`. Fix: amend ADR 0003. Verified.

Judgement calls (smells; a documented repo standard overrides them):
- **S2. Leaky tracing.** `services/runs.ts:1-3` imports `@opentelemetry/api` (`Span`) and OpenInference's `SemanticConventions` to build `withPipelineSpan`. Services should only need `withSpan`. Fix: a small helper in `utils/spans.ts` that takes a session id. Verified.
- **S3. A re-declared type.** `services/runs.ts:163` declares `type State = "pending" | "running" | "done" | "failed"` instead of using the shared `StepState`. Verified.
- **S4. Shotgun surgery on error codes.** `FAILURE_MESSAGES` (`services/runs.ts:42`) spells out its keys by hand, so a new code means edits in four places. Fix: derive the key type from `RunErrorCode`. Verified.
- **S5. Duplicated verdict literals.** `assessCoverage.ts:40` and `:86` repeat `["met", "partially_met", "unmet"]`; shared already exports `CoverageVerdictSchema`. Verified.
- **S6. Nested ternary for step states** (`services/runs.ts:167`): it would read better as a map from step key to state.
- **S7. Duplicated "verdict by id" lookup** in `matchScore.ts` and `toRunView`, each with its own fallback for a missing verdict. Small.
- **S8. `renderRequirements` lives in `renderCv.ts`**: the file name doesn't suggest it.
- **S9. `coverageLlm` is optional** with a fallback to `llm`. Production always passes it; tests use the fallback.
- **S10. `{ coverage, downgrades }`** is spelled out in both `assessCoverage` and `applyClaimRule`.

`isClaimId` matching on the ID string was also flagged. It is deliberate (decisions, "Coverage rules": the rule relies on section-type ID prefixes) and is not a finding.

## Spec

- **P1. `CLAUDE.md` doesn't say what `prompts/` may import.** Decisions, "Structure": "`prompts/` imports only shared types." The new `CLAUDE.md` line describes the folder but not the rule; ticket 02 left it out too. Verified.
- **P2. The Ollama block in `.env.example` would break startup if uncommented as written.** `# LLM_COVERAGE_MODEL=` uncommented sets an empty string, which `config.ts` rejects (`min(1)`), contradicting the "unset" comment above it. The ticket asked for exactly that line, so the gap started in the ticket. Verified.
- **P3. A failed Run shows `job` once extraction is stored** (`services/runs.ts`). The plan's table lists only `error` for the failed rows. Harmless, arguably better (the job is known), and pinned by a test. Not asked for.
- **P4. The CV prompt prints more than the plan listed**: location on job lines, the URL on project lines, issuer and date on certification lines. Harmless, and useful for Coverage.
- **P5. A section's own ID (`sec1`) is valid Evidence but never shown to the model.** `collectItemIds` adds it (`coverageRules.ts:35`), while `renderCv` prints only `secN.iM` lines. If the model ever cited `sec1`, it would pass the checks and count as shown in use. Fix: drop section IDs from `collectItemIds`. Verified (also noticed during ticket 02).

## Checks
- `pnpm typecheck`: passes.
- `pnpm --filter backend test`: 18 files, 219 tests, all pass. Shared tests: 30, all pass.
- No `extractRun` or `extraction.failure_reason` left outside the slice docs.

## Owner's decision
- **Fix:** S1 and P1 (docs, written by an Opus subagent); P5, P2, S2, S3, S4 and S5 (code, [ticket 10](./tickets/10-review-fixes.md), a Sonnet subagent).
- **Keep as is:** P3 (a failed Run shows `job`: better than the plan and tested), P4 (extra CV fields help Coverage), and S6 to S10 (readability preferences with no behaviour change).
