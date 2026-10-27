# Handoff: slice 6a done, next is slice 6b

## Where things stand
- **Review.** `POST /runs/:id/review` takes one decision for every Change: `accept`, `reject`, or `revise` with the user's text (`after` for `replace` and `add`, `orderedItemIds` for `reorder`). It returns 202 and resumes the graph.
  - Errors: 404 if the Run is unknown, expired or deleted meanwhile; 409 if it is not `awaiting_review`; 400 if the decisions do not cover the Changes exactly or a revision fails stage 1.
  - `review` is a real `interrupt()`. After it, a `final_rejudge` node re-judges only the Requirements that rejected or revised Changes list. If that re-judge fails, the Run still ends `completed`, with those Requirements back at their verdicts from before tailoring.
  - The graph now ends: the runner writes `completed`, and the `completed` view applies only the accepted and revised Changes. `download` is `{ docx: null, pdf: null }` until 6b.
- **P6 fixed.** One map from graph position to status, `STATUS_AT_POSITION` in `services/runs.ts`, used by the runner, the nodes and recovery. Recovery puts a Run whose graph has ended to `completed`.
- **`DELETE /runs/:id`.** 204 for a resting Run (row first, then its checkpoints); 409 while busy (`parsing`, `extracting`, `tailoring`); 404 otherwise. An open stream on the Run closes.
- **TTL sweep.** It runs in the backend process at startup (after recovery) and every `SWEEP_INTERVAL_MS`. It deletes expired Runs with their checkpoints, expired `job_profiles` rows, and orphaned checkpoint threads.
  - It skips the Runs this process is running (an in-process set in `RunsService`). Any other expired Run is deleted only if its status is still the one it listed, in the same statement.
  - Shutdown stops the sweep before closing the server.
- **Docs:** `decisions.md` (decisions, "After implementation", both proofs), `review.md` (findings and the owner's decision: all recommendations taken). Spec #42, tickets #43 to #46.
- **Tests:** 665 backend, 34 shared; `pnpm typecheck` passes. No test calls a model.

## Running it locally
- A short TTL for trying the sweep: `env -u LLM_MODEL -u LLM_JUDGE_MODEL -u LLM_TIMEOUT_MS RUN_TTL_DAYS=0.0007 SWEEP_INTERVAL_MS=20000 pnpm dev` (about 60 s per Run).
- `scripts/proof-run.sh --review accept-all|reject-first|revise-first` runs a Run through the Review. The answers file is `{ "answers": [{ "kind": "has_experience", "questionId": "q1", "text": "..." }] }` and must match the Run's Questions (the model asked 4 or 5 on the same inputs). Specific answers give Changes; the same vague sentence for every Question gave none.
- The dev log lines have no timestamps. To line up sweeps with a Run's status, prefix them yourself (`tail -f backend/logs/dev.log | while read l; do echo "$(date +%T) $l"; done`).

## Follow-ups
- **Notes for slice 7** (in `decisions.md`): numbering after a rejected `add`, a revised reorder listing every Item, `tailor` shown running for a Run with no Changes, and no flag in the view when the final re-judge fell back.
- **Accepted, not fixed:** P3 (`accept`/`reject` with revision fields is a 400), S5 (the `tailoring` view infers "re-judge after Review" from Change statuses), S9 (`deleteThread` only forwards).
- **Owner to-dos still open:** `scripts/worktree.sh prune-dbs --yes` (old test databases); close #6 to #17 and #19; delete old branches (`feat/shared-schemas`, `feat/slice-1/2/3-*`, local `feat/slice-5b-live-updates`, `chore/retro-5b`); check whether the GitHub handle belongs in `local-cvs/.private-names`.

## Next
- **Slice 6b** (`06b-export`): DOCX/PDF export of the Tailored CV. An `export` node before the end fills `download`; `DELETE` and the sweep then also remove exported files. Open questions: template, libraries, files on disk versus rendering on demand. That last one probably needs an ADR touching ADR 0002. Start with a grilling session.
- Then slice 7 (frontend). It **must start with a Claude Design pass**, and it consumes the event stream.
