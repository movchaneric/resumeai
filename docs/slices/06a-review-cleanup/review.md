# Slice 6a review

Two-axis review (`mattpocock-skills:code-review`) of `feat/slice-6a-review-cleanup` against `master`, after #43 to #46, the proof and the `proof-run.sh` fixes. Spec: #42. **Owner's decision: pending.** The recommendation column is Opus's.

## Standards
No hard violations; imports, layers and wiring follow `CLAUDE.md`.

| # | Finding | Recommendation |
|---|---|---|
| S1 | `RunStore.deleteUnless(id, busy, liveAt?, cutOffBefore?)`: the one caller always passes both trailing arguments, so the `CODING_STANDARDS.md` parameters rule wants them required (borderline hard) | Goes away with the P1 fix |
| S2 | `purgeRun(id, undefined, startedAt)`: two positional optional dates; `liveAt` and `deleteUnless` are unclear names | Goes away with the P1 fix |
| S3 | The "not busy OR created before X" Prisma filter is written twice in `stores/runs.ts` | Goes away with the P1 fix |
| S4 | Position → status is mapped three times again: runner, `recoverRun`, `NODE_STATUS.review` | Fix: one map next to `positionOf` |
| S5 | The `tailoring` view infers "re-judge after Review" from Change statuses; `run.status === "completed"` is tested three times in the review branch | Accept |
| S6 | `submitReview` copies `submitAnswers`, and `runReview` copies `runResume`'s try/catch; two more hand-written `events.publish` calls | Fix with P2: one "claim a paused Run and resume it" helper |
| S7 | `SweepDeps.now?` is never passed; the scheduler's `started` guard covers a double start no caller makes | Fix: drop `now?` (the guard may stay) |
| S8 | `CHECKPOINT_TABLES`, `rowsFor` and the Postgres checkpointer setup are copied between `sweep.test.ts` and `deleteRun.test.ts` | Fix: shared helper in `test/fakes` |
| S9 | `LangGraphRunner.deleteThread` only forwards to the checkpointer | Accept (keeps LangGraph behind `GraphRunner`) |

## Spec
Nothing missing; core rules verified (P6, Review validation, re-judge set and fallback, `completed` view, `DELETE`, sweep targets, scheduling and shutdown).

| # | Finding | Recommendation |
|---|---|---|
| P1 | **The sweep can delete a Run this process is running.** A Run created before a restart, at a Pause, resumed after it, goes `tailoring` with `createdAt < startedAt`; if it expires mid-run, the sweep deletes its row while the runner keeps writing (the orphan scan later removes the checkpoints, so ADR 0002 holds, but the Run fails silently). The flaw is in the "created before startup" rule added in review of #46. | Fix: `RunsService` keeps the set of Run ids this process is running (added when started or claimed, removed when the work ends); the sweep skips those and deletes any other expired Run only if its status is still the one it listed, in the same statement. Safe because an expired Run cannot be resumed (404) and a stale busy Run cannot be claimed. Replaces the `startedAt` rule; update "TTL sweep" in `decisions.md`. |
| P2 | A `DELETE` between `submitReview`'s status check and its claim gives 409 instead of 404 (same in `submitAnswers`). Safe; only the code is wrong. | Fix with S6: re-read after a lost claim; a gone Run is 404 |
| P3 | An `accept`/`reject` carrying `after` or `orderedItemIds` is a 400; not in the spec | Accept (harmless tightening) |
| P4 | `docs/README.md` still lists 6a as "Planned" | Fix (docs, Opus) |
