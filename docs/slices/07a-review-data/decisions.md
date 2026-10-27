# Slice 7a: Review data and fit cost, decisions

Settled in the slice 7 grilling (2026-10-27); every decision is owner-approved. Spec: #61, tickets #64 to #66. It's backend groundwork for the Review screen (slice 7c, #63), and runs in parallel with the frontend core (7b, #62). The full slice 7 reasoning is in `docs/slices/07b-frontend-core/decisions.md`.

## `originalCv` in the view (#64)
- **The gap:** in `awaiting_review`, `cv` is the original with every Change applied. Removed bullets are missing, a reordered list has lost its original order, and nothing marks which bullets are added. So the Review screen can't show a removal in place, show "Original order", or know which bullets can be dropped.
- **The fix:** `awaiting_review` and `completed` gain `originalCv` (the extracted CV, no Change applied), and the client lays the Changes over it. `completed` gets it too, so Done's "See what changed" reuses the Review's CV component.
- **Rejected:**
  - flags on the applied CV's Items (`origin`, `removed`), because removed Items would still have nowhere to live;
  - deriving everything from the Changes, which fails for removals and reorders.

## A faster fit check (#65)
- **The need:** the Review's live fit preview calls `POST /runs/:id/review/preview` after each decision, debounced (600ms) and cancelled when a newer one starts.
- **The fix:** `measureFit` uses a binary search over the size steps (fit is monotonic), about 3 renders instead of up to 7. This was the 6c follow-up in `docs/slices/06c-one-page/review.md`.
- **Tests:** route tests that don't need real PDFs stub the measure. The `reviewFit` route test took about 21 minutes in a flake check.

## Shared drop rules (#66)
- **The need:** the browser must say which bullets can be dropped, and predict which Requirements the submit re-judges. The rules were subtle in 6c, and a second copy would drift.
- **The fix:** move the pure helpers to `@resume-ai/shared`:
  - `cvItems`;
  - `applyChanges`;
  - from `review.ts`: `applyDecisions`, `keptChanges`, `userDrops` and `dropProblem`.
- **Stays in the backend:** `reviewProblem`, because it uses stage-1 checks. No behaviour change: the moved tests and the backend suite pass as they are.

## Settled during implementation
- **The probe order in `measureFit` (#65):**
  - **Order:** step 0 first (1 render, the common case, and tailoring rounds measure every round), then the floor (2 renders when the CV is over: the floor's overflow is the answer), then a binary search over the steps in between (at most 5 renders, down from 7).
  - **Why not floor-first:** an earlier floor-first version capped the search at 4 renders, but a CV that fits at the normal size then cost 4 renders instead of 1, which slowed the routes that measure such CVs. The ticket's "at most 4" was an estimate, not a requirement.
  - **Tests:** check the exact counts (1 and 2) and the cap (5), and compare against a linear scan on real renders.
  - **Timings:** the route suite went from 46.3s to 24.9s, and `reviewFit.test.ts` from 31.7s to 13.0s.
- **No stubbed fit in route tests (#65):** the ticket assumed the services already accept a swappable fit-checking function, but `RunsService` and the graph call `fitOf`, `reviewFit` and `measureFit` directly. Adding a `measure` dependency through `RunsDeps` and the graph is a design change, not worth it once the search made the slow file fast. `measureFit` only gained an optional `render` argument for its own tests.
- **What moved to shared (#66):** besides the helpers listed above, `revise` moved too, renamed `reviseChange`, because `reviewProblem` needs it. `shared/src/testCv.ts`, a copy of the backend test CV with its IDs written out, serves the moved tests and is left out of the shared build.
- **Watch:** one full backend run saw `test/graph/checkpointer.test.ts` ("pauses for Answers and resumes…") fail once. It passed alone and in the next full run, and it doesn't touch the moved code.

## Proof
A real Run through `scripts/proof-run.sh`. At `awaiting_review`:
- a removed bullet is in `originalCv` but not in `cv`;
- a timed preview is faster than before (record both timings).
