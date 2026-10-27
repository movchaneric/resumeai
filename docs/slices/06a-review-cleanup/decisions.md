# Slice 6a decisions: Review and cleanup

Settled in a grilling session (2026-10-26). All decisions are owner-approved. Terms follow `CONTEXT.md`, which was updated in the same session (**Review**, and the **Change** entry: a revised Change goes into the Tailored CV exactly as written).

Spec: #42 "Slice 6a: Review and cleanup"; tickets #43 to #46.

## Split
- Slice 6 is split. **6a**: the Review, the P6 fix, `DELETE /runs/:id` and the TTL sweep. **6b** (`06b-export`): DOCX/PDF export, which then extends `DELETE` and the sweep to exported files. Export has its own design questions (template, libraries, files on disk versus rendering on demand) and probably an ADR touching ADR 0002.

## Review
- **One Review per Run, and it is final.** After it, the graph goes to the end; there is no further tailoring round. Rejected: a Review that loops back into tailoring with revised Changes locked.
- **`review` becomes a real `interrupt()` inside the node**, like `collect_answers`; `interruptBefore: ["review"]` goes. Everything before the `interrupt()` must be pure (the node runs again from the top on resume).
- **One submission:** `POST /runs/:id/review` with a decision for every Change: `accept`, `reject`, or `revise` with the user's text (`after` for `replace` and `add`, `orderedItemIds` for `reorder`). It resumes the graph like Answers do. Rejected: a `PATCH` per Change plus a "finish" call (partial review state in the checkpoint). The frontend keeps drafts.
- **Responses:**
  - 409 if the Run is not `awaiting_review`; a race is settled by `claimStatus` (`awaiting_review` → `tailoring`).
  - 400 if the decisions do not cover exactly the Run's Changes (missing, duplicate or unknown ids), a revision's text is empty, a revision's field does not fit the Change's `op`, or a revision fails stage 1.
  - 202 when accepted; the client follows the event stream until `completed`.
- **Revised Changes:** trusted, so no claim check; stage 1 still applies (text Items only, never dates, companies, titles or degrees, a reorder must be a permutation). A failing revision is a 400 and nothing is resumed.
- **Claim-check rejections stay out of the Review.** Only the Changes in the view are decided.

## Match Score after the Review
- **Re-judge only the Requirements that rejected or revised Changes list**, against the reviewed CV (the ADR 0003 partial re-judge rule); every other verdict carries over. If every Change was accepted, nothing is re-judged. Rejected: keeping the proposed score (wrong after a rejection), and reverting verdicts without LLM calls (undercounts when an accepted Change also helped).
- **If the re-judge still fails after the chains' retries,** the Run still ends `completed`; each affected Requirement goes back to its verdict before tailoring, so the score errs low and never overstates. The failure is logged and recorded on the span; the view does not flag it (slice 7 can add a flag).
- **Status during the re-judge is `tailoring`**, so crash recovery covers it unchanged; the view's steps show `review` running. No new status.

## End of the graph (and P6)
- 6a's graph: … → `review` (interrupt) → final re-judge → end. The re-judge is its own node after `review`: `review` reruns from the top on resume, so it only records the decisions, and a cut-off re-judge resumes from its checkpoint like any `tailoring` Run.
- **Old dev Runs:** a Run that reached Review before 6a paused with `interruptBefore` and has no interrupt task, so it cannot be reviewed. Not migrated (ADR 0003); start a new Run. The runner writes **`completed`** when the graph ends, with `download: { docx: null, pdf: null }` until 6b adds an `export` node before the end.
- **The `completed` view:** `cv` is the original CV with only the accepted and revised Changes applied; each Change in `changes` carries its final status.
- **P6 fixed with S4 folded in:** one function maps the graph's position to `answers`, `review`, `ended` or running, used by the runner, the service and recovery (it was three places). "Nothing left to run" means ended, never `review`.
- **Recovery table gains a row:** a checkpoint at the end → `completed` (covers a crash between the last checkpoint and the status write). The P6 proof test: a Run in `tailoring` whose graph has ended is recovered to `completed`, not `awaiting_review`.
- S6 (publishing by hand) stays deferred.

## `DELETE /runs/:id`
- Deletes the `runs` row and all the Run's checkpoint rows; 204.
- **409 `RUN_BUSY`** while the Run is `parsing`, `extracting` or `tailoring`: the runner would otherwise write checkpoints after the delete and bring the data back. Runs reach a Pause or the end within minutes. Rejected: mark-for-deletion, and delete-now-and-let-the-sweep-catch-orphans.
- Unknown, malformed, expired or already-deleted Run: 404.
- **Order:** the `runs` row goes first, in one conditional delete (not busy, not expired), then the checkpoint thread. A concurrent `POST /answers` either claims first (`DELETE` gets 409) or finds the row gone (404). If the thread delete fails, the response is still 204 and the sweep removes the orphaned thread.

## TTL sweep
- **In the backend process** (one instance assumed, as in 5b), at startup and every `SWEEP_INTERVAL_MS` (default 3 600 000). Rejected: `pg_cron`, an external cron job.
- **Startup order:** `listen` → `recoverRuns` → first sweep → interval. Recovery already skips expired Runs; sweeping after it means a recovered Run is never deleted halfway through.
- **Deletes:** expired Runs (row and checkpoints; exported files from 6b), expired `job_profiles` rows, and **orphaned checkpoint threads** (a `thread_id` with no `runs` row), so ADR 0002's promise holds even after a partial failure.
- **Skips** every Run this process is running: `RunsService` keeps an in-process set of Run ids, added when it starts or claims a Run and removed when that work ends. Any other expired Run is deleted only if its status is still the one the sweep listed, checked in the same statement (compare-and-delete). Safe because an expired Run cannot be resumed (404) and a stale busy Run cannot be claimed, so a Run outside the set stays outside it. `DELETE` still refuses every busy Run. (Replaces the "created before startup" rule from review of #46, which deleted a Run created before a restart and resumed after it; P1 in `review.md`.)
- Deletes go through the checkpointer's `deleteThread` where possible; raw SQL only for the orphan scan, and it lives in a store.
- **Shutdown** clears the interval and waits for a sweep in progress.

## Tickets
| Ticket | Scope | Depends on |
|---|---|---|
| T1 (#43) | Review as an `interrupt()`, P6 fix with S4, `completed` at the end, recovery row, shared `ReviewDecisionSchema` and `GraphRunner.review` (no route) | — |
| T2 (#44) | `POST /runs/:id/review`: validation, stage 1 for revisions, final re-judge and fallback, `completed` view | T1 (#43) |
| T3 (#45) | `DELETE /runs/:id` and the delete-a-Run helper (row and checkpoints) | — |
| T4 (#46) | TTL sweep: expired Runs, `job_profiles`, orphaned threads; interval and shutdown | T3 (#45) |

Order: T1 and T3 in parallel worktrees, then T2 and T4 in parallel.

## Proof
- `scripts/proof-run.sh` gains `--review accept-all|reject-first|revise-first`.
- One real-model Run that rejects one Change and revises another. Check:
  - the `completed` view applied only the accepted and revised Changes;
  - the score moved only where Requirements were re-judged;
  - `DELETE` then gets 404;
  - the sweep with a 1-minute TTL;
  - `app.runs` and the checkpoint tables have no rows left for the Run.

## No ADR
Nothing in 6a is hard to reverse. 6b probably needs one (files on disk versus rendering on demand, which changes ADR 0002's wording).

## After implementation
Changes and findings from the build, the reviews of each ticket and the proof.
- **`DELETE` order and busy statuses** (#45): `parsing` also counts as busy. The `runs` row goes first in one conditional delete, then the thread. `purgeRun` also publishes, so an open stream on the Run closes on its 404.
- **Sweep deletes stale busy Runs** (found in review of #46), then **skips the Runs this process is running** (P1 in the slice review, which replaced the "created before startup" rule): see "TTL sweep". A pass is scheduled only when the previous one ends; shutdown stops the sweep before closing the server and pools.
- **One `review` root span**, opened by the service (found in review of #44; the runner opened a second one).
- **Graph position in one place** (#43, S4): `graph/position.ts`; `RunSnapshot.pausedAt` became `position` (`answers | review | ended | null`). After the slice review, the position → status map is `STATUS_AT_POSITION` in `services/runs.ts`, next to `RunSnapshot`, so `services/` imports nothing from `graph/`.
- **Slice review fixes:** `submitAnswers` and `submitReview` share one claim-and-resume helper; a claim lost to a `DELETE` is 404, not 409 (P2, S6). The sweep's store calls are `listExpired` and `deleteExpiredIn` (compare-and-delete on the listed status); `DELETE` uses `deleteIdleLive`.
- **Notes for slice 7, no change now:**
  - When an `add` is rejected, later added Items in that list are numbered from the kept ones, so a reorder that listed them may place them slightly differently. Nothing is lost.
  - A revised reorder must list every Item under the parent as proposed, including Items from `add` Changes the user rejects.
  - A Run with no Changes shows `tailor` running for the moment before it completes.
- **`proof-run.sh`** (found in the proof): a bare-array answers file was accepted but rejected by the server; the `--review` summary had a jq quoting error; `revise-first` could not revise an `add`. All three are fixed (checked with `bash -n` and the jq programs on sample JSON; not rerun against a server).

## Proof (2026-10-26)
Made-up CV fixture (`backend/test/fixtures/cv.docx`) and a made-up Job Description, `gemini-3.5-flash-lite` for both models.
- **First start:** the sweep removed 417 orphaned checkpoint rows left by older dev Runs.
- **Run 1, `reject-first`:** two `add` Changes (`r1.c1` for req5, `r2.c1` for req1). Scores from the checkpoint history: 70.3 before tailoring, 79.7 after round 1, 89.1 proposed at Review, 79.7 after rejecting `r1.c1`. Only req5 was re-judged, back to `partially_met`. The `completed` CV holds `r2.c1`'s text and not `r1.c1`'s; `download` is null.
- **Run 2, revise by hand:** `r1.c1` revised (its own text plus a short edit), `r2.c1` accepted. 202, then 409 on a second POST. The revised text is in the CV, req5 was re-judged against it (still `met`), and the score stays 89.
- **`DELETE` on Run 1:** 204, then 404 on `GET` and on a second `DELETE`. Rows before: 1 run, 18 checkpoints, 73 blobs, 61 writes; after: none.
- **Sweep:** restarted with `RUN_TTL_DAYS=0.0007` and `SWEEP_INTERVAL_MS=20000`. A new Run (`failed`, 13 checkpoint rows) was gone from all four tables after it expired; the log shows `deleted 1 expired Runs`.

## Proof of the review fixes (2026-10-27)
Same fixture CV, a new made-up Job Description, `gemini-3.5-flash-lite`, `RUN_TTL_DAYS=0.0007` (about 60 s) and `SWEEP_INTERVAL_MS=20000`.
- **Sweep:** five Runs (paused at `awaiting_review` or `completed`) were each deleted after they expired, one `deleted 1 expired Runs` line each; no rows left in `app.runs` or the four checkpoint tables, no orphaned checkpoint rows, no failure in the log.
- **Run that expires mid-work:** not caught live. A Review was submitted 0.8 s before expiry, and Answers 6 s before, but the work ended (2 s of tailoring) before a sweep pass landed. The case is covered by `sweep.test.ts` against Postgres and the real service, which fails without the running-set check.
- **`proof-run.sh --review revise-first`:** works live. One `add` Change revised and four accepted; `completed`, score 28 → 77. Two earlier Runs answered with the same vague sentence for every Question ended with no Changes (`ceiling`), and the script correctly said there was nothing to revise.
- The model asked 5, 4 and 5 Questions on the same inputs, so an answers file must match the Run's Questions.
