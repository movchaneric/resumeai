# Slice 4a review: the tailoring loop

Scope: `git diff master...feat/slice-4a-tailoring-loop` (32 commits, up to `0ac4b84`). Two read-only Opus reviewers ran in parallel: **Standards** (root `CLAUDE.md`, `CONTEXT.md`, the ADRs, plus a code-smell baseline) and **Spec** (`decisions.md`, tickets #5 to #17). Opus checked the findings against the code before writing them here.

**Summary.** No hard standards violations and no serious correctness bugs. The promises most likely to slip quietly all hold: the claim check never sees the Job Description, the numbers stay frozen, one Change per Item, undo, the error exit, the second chance before the ceiling, the Job Profile on the judge client, the Run views, the migration, the checkpoints schema, the span attributes, the `LLM_JUDGE_MODEL` fallback and the dev script's `--tailor`. `pnpm typecheck` passes; backend tests 376/376; shared tests 31/31.

Standards: 12 judgement calls. Spec: 10 small deviations. The worst on each axis: nothing tests that `TRACE_CONTENT=false` hides content on LangGraph's spans (Standards); a failed status write in round 2 fails the whole Run and loses round 1's result (Spec).

## Standards

No hard violations. Judgement calls (smells; a documented repo standard overrides them):
- **S1. Test gap against ADR 0006.** `TRACE_CONTENT=false` relies on `hideInputs`/`hideOutputs` (`utils/tracing.ts`). LangGraph's chain spans carry the whole `RunState`, including `cvText` and `jobDescriptionText`. The only hidden-content test covers a single LangChain call; nothing runs the graph with content off.
- **S2. Named spans sit beside LangGraph's tree, not under it.** `tailor`, `validate`, `assess_coverage` and `claim_check` attach to `pipeline`, not to the node spans. `spans.test` asserts the flat tree but never instruments LangChain.
- **S3. The dev script splits a run in Phoenix.** It uses one random id as `thread_id` and another for the `pipeline` session. Verified: two `randomUUID()` calls in `test/extractReport.ts`.
- **S4. Item-ID helpers overlap.** `tailoring/stage1Checks` imports `collectItemIds` from `scoring/` (no rule forbids it); it overlaps `allIds` in `tailoring/cvItems`; `tailorCv` has a private `textItems` with a different shape from `cvItems.textItems`.
- **S5. Retry-once copied three times.** The pattern appears in `tailorCv`, `claimCheck` and `assessCoverage`. `TailorError` and `ClaimCheckError` duplicate `CoverageError` and break the one-`errors.ts`-per-layer pattern.
- **S6. `CLAUDE.md` is stale.** The `graph/` line says nodes call `extraction/` and `scoring/` (they also call `tailoring/`); the `scoring/` line doesn't mention the exit router.
- **S7. "Entry" wording.** "entry/entries" is used in tailoring code and in a stage-1 rejection reason sent to the model, though `CONTEXT.md` says to avoid "Entry" (use Item). Verified in `tailoring/cvItems.ts` and `tailoring/stage1Checks.ts`.
- **S8. Data clump.** `PendingRound` and `RoundSummary` repeat the same round fields.
- **S9. Reserved list IDs spelled out three times**, and the section-ID pattern is hard-coded.
- **S10. `consecutiveEmptyRounds` is optional** with a default of 0, though the only caller always passes it. Verified.
- **S11. A racy timeout test.** The `parseCv` timeout test races a 1 ms timer. It comes from master, not this branch.
- **S12. `toRunView`'s `awaiting_review` guard** is a long `&&` chain followed by non-null assertions.

## Spec

- **P1. A failed status write in round 2 fails the whole Run, losing round 1's result.** `onEnter` runs before the `try` in the `tailor`, `validate` and `rejudge` nodes. Spec: "Failures inside the loop are not Run failures." Verified.
- **P2. The round-failure log has no `code` field.** The spec lists code, error name and issue count.
- **P3. An incomplete `awaiting_review` state falls through to the extracting view** without a warning.
- **P4. No test pins each node to its status** (ticket #12). Verified: no test references `NODE_STATUS`.
- **P5. Postman's "Get run (awaiting_review)" doesn't poll**; it must be re-sent by hand.
- **P6. `runs` still has `export_path`**, which the spec's keep-list omits.
- **P7. A test helper imports LangGraph's `MemorySaver` directly** instead of the `graph/` factory.
- **P8. Stale "later" wording.** `.env.example` and a `runGraph` comment say the tailor and claim check come later; also the `CLAUDE.md` `graph/` line (S6).
- **P9. An unrelated commit in scope.** `b279c49` (Matt Pocock skills setup: `docs/agents/`, the `CLAUDE.md` Agent skills section, `docs/README` renumbering) is not part of #5 to #17.
- **P10. The `RoundSummary`/`onRound` observer hook is not in the spec**, but #15 needs it. Plain data; accepted.

## Checks
- `pnpm typecheck`: passes.
- `pnpm --filter backend test`: 376 tests, all pass. Shared tests: 31, all pass.

## Owner's decision (2026-10-25)
- **Fix in code:** P1, S1, P4, S3, S10, S11, S7, S9, P7 and the code part of P8 ([#19 "4a-13: Review fixes"](https://github.com/movchaneric/resumeai/issues/19), a Sonnet subagent).
- **Fix in docs:** S6 and the `CLAUDE.md` part of P8 (written by an Opus subagent).
- **Keep as is:** S2 (readable as it is; nesting needs OTel context wired through LangGraph, better done on its own), S4, S5, S8 and S12 (refactors with no behaviour change; candidates for slice 5), P2 (loop failures have no error code), P3 (cannot happen given how nodes write state), P5 (same as slice 3; fine for manual testing), P6 (ADR 0003 lists the export path as Run metadata; the spec's list was wrong), P9 (deliberate workflow setup; called out in the PR description) and P10.
