# 03 Run view and storage

Plan: "Behaviour seen from outside", "`shared/`", "`backend/src/stores/runs.ts` and Prisma", and the `toRunView` part of "`backend/src/services/runs.ts`". Decisions: "Storage", "Run view and errors".

Needs ticket 02 merged (`matchScore`).

## Changes
- `shared/src/run-view.ts`:
  - `StepStateSchema` gains `failed`.
  - `RunErrorCodeSchema` gains `COVERAGE_FAILED`.
  - New `ScoredRequirementSchema` and the `scored` variant, as in the plan. Export the types and add them to `shared/src/index.ts` if needed.
  - Shared tests for all three.
  - Rebuild shared (`pnpm --filter @resume-ai/shared build`) before typechecking the backend.
- Prisma: a migration adding nullable `coverage JSONB` (`@map("coverage")`, `@db.JsonB`), created with `pnpm --filter backend db:migrate` (name it `add_run_coverage`). Update the transitional comment.
- `stores/runs.ts`: `StoredRun.coverage: Coverage[] | null`, parsed on read. Add `saveCoverage(id, coverage)`, which sets `coverage` and `status: "scored"`.
- `services/runs.ts`: rewrite `toRunView` to cover every row of the plan's table:
  - The failed step is `coverage` when `cv` and `jobProfile` are stored, else `extract`.
  - `scored` gets `score: Math.round(matchScore(jobProfile.requirements, coverage))` and `requirements` in Job Profile order.
  - Update its doc comment.
  - Add the `COVERAGE_FAILED` entry to `FAILURE_MESSAGES`: "We couldn't assess your CV against this job. Try again." Leave `extractRun` and `failureCode` alone; ticket 05 changes them.
- Fake store in `test/services/runs.test.ts`: implement `saveCoverage`.

## Tests (test-first)
- Service tests: `toRunView` through `getRunView` with a fake store, one case per row of the plan's table. The `scored` case uses a small made-up Job Profile and coverage, and checks the rounded score (for example, 2 must-haves met and partially met plus 1 nice-to-have unmet: 100 × 4.5 / 7 = 64.28…, shown as 64).
- Route tests (real test DB): a Run with coverage saved through the store reads back as `scored`; a failed Run with extraction stored shows `coverage: failed`.

## Done when
`pnpm typecheck` passes; `pnpm --filter @resume-ai/shared test` passes; your service and route test files pass. Commits: shared schema, migration and store, view.
