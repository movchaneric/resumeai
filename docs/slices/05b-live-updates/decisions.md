# Slice 5b decisions: live updates and crash resume

Settled in a grilling session (2026-10-26). All decisions are owner-approved. Terms follow `CONTEXT.md`, which was updated in the same session (**Pause**, **Interrupted Run**).

Spec: [#37](https://github.com/movchaneric/resumeai/issues/37) "Slice 5b: Live updates and crash resume"; tickets are linked from it.

## Live updates (SSE)
- **One stream per Run:** `GET /runs/:id/events`. An unknown, malformed or expired Run gets the usual 404 before the stream opens.
- **One event type, `run`, carrying the full `RunView`**, the same JSON `GET /runs/:id` returns. It is sent on connect and on every change; a view identical to the last one sent is skipped. Rejected: typed delta events (`status`, `step`, `round`, `done`), which would need a new schema and a client-side state machine.
- **Pushes** come after each node ends, after each status write (`setStatus`, `claimStatus`, recovery writes) and after `markFailed`.
- **The stream closes** after a view whose status is `awaiting_answers`, `awaiting_review`, `failed`, `interrupted` or `completed`, so no connection idles through a Pause. The client opens a new stream after posting Answers.
- **Heartbeat** comment every 15 s. **`Last-Event-ID` is ignored:** every event is a full snapshot, so a reconnect is just a connect.
- **Polling stays.** `GET /runs/:id` is unchanged; SSE is added beside it. Slice 7 uses SSE and falls back to a GET.
- **`RunEvents`** (defined by the service layer): `publish(runId)` and `subscribe(runId, listener)`. Only the Run id travels; each subscriber rebuilds the view through the existing view builder, so there is one source for the view.
- **Single instance (assumption).** The bus is an in-process emitter: a stream only sees Runs worked on by the same process. No ADR, because moving to Postgres `LISTEN/NOTIFY` later changes only the `RunEvents` implementation.

## Crash resume
- **Automatic, on startup.** The server listens first, then resumes cut-off Runs in the background, **one at a time** (the Gemini free tier rate-limits parallel calls).
- **Cut-off Runs** are the non-expired Runs in `extracting` or `tailoring`. With one instance, any such Run at startup was cut off by the previous process. Pauses (`awaiting_answers`, `awaiting_review`) are durable and left alone. Expired Runs are skipped (the slice 6 TTL sweep deletes them).
- **Per Run, from the checkpoint:**

  | Checkpoint | Action |
  |---|---|
  | None (cut off before the first checkpoint, so the texts are lost) | `interrupted` |
  | At a Pause: a lost status write, or claimed Answers that were never resumed | write that Pause's status; the user re-submits lost Answers |
  | Mid-graph, `recoveries` = 0 | increment `recoveries`, resume from the last checkpoint |
  | Mid-graph, `recoveries` ≥ 1 | `interrupted` |

- **One recovery per Run** (`runs.recoveries`, new column), so a Run that crashes the server cannot crash it on every restart. Cost accepted: two unrelated restarts during one Run also end it `interrupted`.
- **Resumed work behaves like the original:** a new `recovery` root span with `session.id` = the Run id and the `pipeline` end attributes. Same failure rules (before the first score → `failed`; inside the loop → round undone, exit `error`). The node that was cut off runs again, LLM calls included.
- **An Interrupted Run is final:** the user starts a new Run. Its view has no extra fields; the step that was running shows `failed`. The wording is slice 7's.
- **No drain on shutdown:** SIGTERM/SIGINT behave as today, and a stop is handled like a crash, so there is one recovery path.
- Rejected: marking every cut-off Run `interrupted` and resuming only when the user asks.

## Testing seams
- **The HTTP app** (`createApp` + `supertest`, real graph on the in-memory checkpointer, fake LLM) for the stream.
- **`RunsService.recoverRuns()`** for recovery. A crash is simulated with a fake LLM that never answers, then a fresh service and runner on the same store and checkpointer.

## Proof
- `scripts/proof-run.sh --watch` prints live events (`curl -N`). Start a Run with it, `kill -9` the server during `tailoring`, restart, and the dev log shows the recovery line; the Run reaches `awaiting_review`.

## Tickets
Blocking edges are GitHub dependencies.

| Issue | Ticket | Blocked by |
|---|---|---|
| [#38](https://github.com/movchaneric/resumeai/issues/38) | 5b-1: Live Run stream (`RunEvents` bus, `GET /runs/:id/events`, `proof-run.sh --watch`) | none |
| [#39](https://github.com/movchaneric/resumeai/issues/39) | 5b-2: Crash resume on startup (`recoveries` column, `recoverRuns()`) | #38 |

- 5b-2 waits for 5b-1 because both change the graph runner and `RunsService`, and recovery writes publish on the bus.
- The proof Run, review and slice docs are done by the orchestrator after both, as in 5a; they are not tickets.

## After implementation
Changes to the decisions above, made during the build, the proof and the review (all owner-approved).

- **Pushes happen when the next node is entered**, and once after the graph returns, not at the instant a node returns. The graph runs with `durability: "sync"`, so the previous node's checkpoint is stored by then and the view is never stale. Without `"sync"`, a stream test failed intermittently on a stale view.
- **The first stream view is serialised with later ones.** Found in review of #38: a change published while the first view was being built could go out before it.
- **Recovery only touches Runs created before the process started** (`recoverRuns(startedAt)`). Found in review of #39: recovery runs once the server listens, so a Run created by the new process in that window could have been marked `interrupted` or resumed twice.
- **"No checkpoint" is rarer than planned.** LangGraph stores a checkpoint when the graph is invoked, before the first node. Only a Run cut off between its creation and the graph start becomes `interrupted` for that reason; a Run cut off inside extraction is resumed.
- **A stop ends the open Run streams.** Found in the proof: `server.close` waited for every connection, and a live stream never ends on its own, so a stop hung until force-killed. Shutdown now ends the open streams and idle connections at once and lets in-flight ordinary requests finish. Running Runs are still not drained.
- **Wiring:** `index.ts` builds the `RunsService` and passes it to `createApp`, because recovery needs the same instance (`CLAUDE.md` updated).

### Proof (2026-10-26, Gemini free tier, `gemini-3.5-flash-lite`)
- **Live events:** a Run followed with `proof-run.sh --watch` showed `extracting` (extract, then coverage), `awaiting_answers` (stream closed), a new stream after the Answers (all skipped), `tailoring` rounds 1/3 to 3/3 with the score, then `awaiting_review` (70 → 73, `max_iterations`).
- **Crash resume:** a second Run was killed with `kill -9` as soon as round 1 started. On restart the log showed `recovery resumed`, and the Run reached `awaiting_review` (68 → 68, 2 rounds, `ceiling`). Phoenix showed a `recovery` root span in the Run's session with the tailoring nodes under it.
- **Found on the way** (environment, not code):
  - The main checkout's generated Prisma client was stale after the migration (it is gitignored and only regenerated by `pnpm install`), so the first recovery attempt failed until `prisma generate` ran. Nothing was lost, because the failed query never counted a recovery.
  - A shell with old `LLM_*` exports overrode `backend/.env` (dotenv never overrides), which caused three timeouts on `gemini-3.8-flash`.
