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

## Proof
A real Run through `scripts/proof-run.sh`. At `awaiting_review`:
- a removed bullet is in `originalCv` but not in `cv`;
- a timed preview is faster than before (record both timings).
