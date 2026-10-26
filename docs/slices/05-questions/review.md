# Slice 5a review: Questions

Scope: `git diff master...feat/slice-5a-questions` (8 commits, up to `79838da`). Two read-only reviewers ran in parallel: **Standards** (`CODING_STANDARDS.md`, `CLAUDE.md`, `CONTEXT.md`, `docs/agents/domain.md`, plus a code-smell baseline) and **Spec** ([#30](https://github.com/movchaneric/resumeai/issues/30), tickets #31 to #34, `decisions.md`). Opus checked the findings against the code before writing them here.

**Summary.** No hard standards violations. Every acceptance criterion of #31 to #34 is implemented and tested. The manual proof passed (see `decisions.md`, "After implementation"). `pnpm typecheck` passes; backend tests 537/537 before the fixes, 538/538 after; shared tests 32/32.

Standards: 3 nits, 8 judgement calls. Spec: 1 partial, 4 small scope additions, 3 questionable points (1 dropped on checking). The worst on each axis: `runResume` copied `runStart`'s failure handling and lost the issue-count log (Standards); the tailor heading said "must-haves first" while the list is sorted User Evidence first (Spec).

## Standards

Nits:
- **S1.** `scoring/assessCoverage.ts`: a comment says "(slice 18)"; it means issue #18. From #28, already on master.
- **S2.** `scoring/assessCoverage.ts`: a doubled blank line. Also from #28.
- **S3.** `tailoring/questions.ts`: the Question text ends in ".." when the Requirement text ends with a full stop.

Judgement calls (smells; a documented repo standard overrides them):
- **S4. Duplicated code.** `runResume` copied the nested try/catch, `failureCode`, logging and `markFailed` from `runPipeline`, without the issue count.
- **S5. Duplicated code.** The verdict map `new Map(coverage.map(...))` is built in `questions.ts`, `exitRouter.ts` and `renderTailor.ts`. "Must-have not met" is decided in both `questions.ts` and `exitRouter.ts`.
- **S6. Data clump.** `userEvidence` and `confirmedGaps` always travel together (state, `runGraph`, `tailorCv`, `renderTailor`, `recordAnswers`).
- **S7. Speculative generality.** `userEvidence?`, `confirmedGaps?` and `onlyGapsLeft?` are optional with defaults, though the graph always passes them.
- **S8. Names.** `routeAfterRound` renames `onlyGapsLeft` to `gapsLeft` to dodge the function name; in `validateChanges.ts` a variable named `answers` holds User Evidence text.
- **S9.** `errorHandler.ts` double-casts `error.type` to detect body-parser errors; a type guard would read better.
- **S10. Feature envy.** `recordAnswers` is a domain rule in `graph/runGraph.ts`; it would sit better beside `selectQuestions` in `tailoring/`.

## Spec

- **P1. Partial.** "The review summary lists them [Gaps]" is met by the per-Requirement `confirmedGap` flag only; there is no separate list.
- **P2. Scope.** Body-parser errors return 400 `BAD_REQUEST` on every JSON route, not just answers.
- **P3. Scope.** `RunStore.claimStatus` moves the Run to `tailoring` before resuming. Not in a ticket, but it is what makes the 409 on a double submit race-safe; it has a real-Postgres test.
- **P4. Scope.** A 64 kb body limit on the answers route.
- **P5. Scope.** New error codes `INVALID_ANSWERS` and `RUN_NOT_AWAITING_ANSWERS`.
- **P6. Questionable.** The tailor heading said "must-haves first", but the list is sorted User Evidence first. The system prompt had the right order, so the user message contradicted it.
- **P7. Questionable, dropped.** The reviewer said an empty round ignores `onlyGapsLeft`. It cannot matter: an empty round keeps the previous Coverage, and the Run would already have stopped on that Coverage if only Gaps were left.
- **P8. Questionable.** Stopping with `ceiling` when only must-have Gaps are left also gives up gains on unmet nice-to-haves. This is the spec's literal rule.
- **P9.** The 1,000-character Answer limit is enforced in the service only; `AnswerSchema` in shared has `min(1)` only.

## Checks
- `pnpm typecheck`: passes.
- `pnpm --filter backend test`: 538 tests, all pass. Shared tests: 32, all pass.

## Owner's decision (2026-10-26)
- **Fixed in code** (`01174a4`, a Sonnet subagent): S1, S2, S3 (with a test that fails without the fix), S4 (one `recordFailure` helper; the resume log keeps the issue count) and P6.
- **Slice to-do:** S5, S6, S7, S10 (refactors with no behaviour change).
- **Slice 7:** P9 (the frontend needs the limit in the shared schema).
- **Keep as is:** S8, S9, P1 (the flag is enough for the review view), P2 to P5 (small and defensible), P7 (cannot happen), P8 (spec rule; revisit if Runs stop early with nice-to-haves left).
