# 09 Clear Evidence on unmet verdicts

Found in the Postman run (2026-10-24, Run `0e3dd9da…`). Two `unmet` verdicts still cited Evidence: one cited the job, one cited a skills entry. The prompt says `unmet` cites nothing, but no code enforces it. In slice 4, cited Evidence means "this supports the Requirement", so an `unmet` with Evidence would mislead tailoring and the review screen.

Decision (owner): our code clears the Evidence list on every `unmet` verdict. The verdict, the reason and the score are unchanged. No retry: the Evidence is harmless to drop and a retry costs a full call. See `decisions.md`, "Coverage rules".

## Change
- `backend/src/scoring/coverageRules.ts`, `applyClaimRule`: when the verdict is `unmet`, the returned `Coverage` has `evidenceIds: []`. Update the function's doc comment, which describes what it normalizes.
- Leave `coverageIssues` unchanged. Unknown Evidence IDs are still issues even on `unmet`, because they show the model is citing things that don't exist.

## Tests (test-first)
`backend/test/scoring/coverageRules.test.ts`:
- an `unmet` verdict citing `exp1` comes back with `evidenceIds: []`, with the same verdict and reason
- an `unmet` verdict with no Evidence is unchanged
- the downgrade count is not affected

## Done when
`pnpm typecheck` and the full `pnpm --filter backend test` pass (Postgres up). One commit ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
