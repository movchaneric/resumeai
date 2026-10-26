# Handoff: slice 5b done, next is slice 6

## Where things stand
- **Live updates.** `GET /runs/:id/events` is a Server-Sent Events stream of the Run's `RunView`.
  - One event type, `run`, carries the same JSON as `GET /runs/:id`. It is sent on connect and then on every change; identical views are skipped and views go out in order.
  - The stream closes after a Pause (`awaiting_answers`, `awaiting_review`), `failed`, `interrupted` or `completed`. The client opens a new stream after posting Answers.
  - A heartbeat comment goes out every 15 s (`config.sseHeartbeatMs`). `Last-Event-ID` is ignored. Unknown or expired Runs get the usual 404.
  - Changes travel on an in-process `RunEvents` bus (`utils/runEvents.ts`) that carries only the Run id. The runner publishes when a node is entered and after the graph returns, and the graph runs with `durability: "sync"`, so a view is never stale. The service publishes after `claimStatus`, `markFailed` and recovery writes.
  - Polling `GET /runs/:id` is unchanged.
  - **One backend instance is assumed.** A move to Postgres `LISTEN/NOTIFY` would change only the bus.
- **Crash resume.** After `listen`, `RunsService.recoverRuns(startedAt)` goes through the non-expired Runs created before this process started that are still in `extracting` or `tailoring`, one at a time:

  | Checkpoint | Action |
  |---|---|
  | none | `interrupted` |
  | at a Pause | that Pause's status |
  | mid-graph, `runs.recoveries` = 0 | count it, resume from the checkpoint under a `recovery` root span |
  | mid-graph, already recovered once | `interrupted` |

  - Status writes are conditional on the status recovery saw.
  - An **Interrupted Run** (new `CONTEXT.md` term, with **Pause**) is final. Its view marks the step that was running as `failed`.
- **Shutdown** ends the open event streams and idle connections at once. Requests in flight finish, and Runs are not drained (recovery picks them up).
- **`scripts/proof-run.sh --watch`** follows a Run through its stream.
- **Docs:** `decisions.md` (with "After implementation" and the proof), `review.md` (owner's decisions), and `CLAUDE.md` (wiring, new `utils/` files). Spec [#37](https://github.com/movchaneric/resumeai/issues/37), tickets #38 and #39.
- **Tests:** 598 backend, 32 shared; `pnpm typecheck` passes. No test calls a model.

## Running it locally
- **After pulling a migration, run `pnpm --filter backend exec prisma generate`** (or `pnpm install`) in every checkout you run the server from. The client is gitignored. In the proof, a stale client made the first recovery fail.
- `prisma migrate deploy` adds `runs.recoveries`.
- **A shell with exported `LLM_*` variables overrides `backend/.env`** (dotenv never overrides). Use a fresh shell, or `unset LLM_MODEL LLM_JUDGE_MODEL LLM_TIMEOUT_MS`.
- `backend/.env` now has `LLM_TIMEOUT_MS=120000` (owner's edit).
- Watch a Run: `curl -sN http://localhost:3000/runs/<id>/events | sed -l -n 's/^data: //p' | jq -c '{status, iterations, score}'`. Pipe through `sed -l`, not `cut`, which buffers.

## Follow-ups
- **Slice 6 must fix P6:** `pausedAtOf` reads "graph ended" as `review`. Once the graph can finish, a completed Run in `tailoring` would be put back to `awaiting_review`.
- **Deferred refactors (`review.md`):** S2 (`createApp` takes deps and service), S4 (Pause mapping in three places), S6 (publishing by hand in five places), S8, S9, S10.
- **Note for slice 7:** a Run cut off while picking Questions shows `tailor` as its failed step (P8). Slice 7 owns the Interrupted Run's wording.
- **Possible tooling:** make `scripts/worktree.sh` or the dev script run `prisma generate`, so a merged migration cannot leave a stale client.
- Still open from slice 5a: the Question mix (4 of 5 were soft skills), the 5a review to-dos S5, S6, S7, S10, P9 (slice 7), #27. Owner items a to c from the 5a handoff (close #6 to #17 and #19, drop old test databases, delete old branches).

## Next
- **Slice 6** (`06-review-export-cleanup`): per-Change review (resumes the graph at `review`), DOCX/PDF export, TTL sweep, `DELETE /runs/:id`. Start with a grilling session.
- Then slice 7 (frontend). It **must start with a Claude Design pass**, and it consumes the event stream.
