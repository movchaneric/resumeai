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
- 6a's graph: … → `review` (interrupt) → final re-judge → end. The runner writes **`completed`** when the graph ends, with `download: { docx: null, pdf: null }` until 6b adds an `export` node before the end.
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
- **Skips** a Run in `extracting` or `tailoring` even if it has expired (same rule as `DELETE`).
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
