# 06 Dev script: `--coverage` and the verdict key

Plan: "Dev script". Decisions: "Quality check".

Needs tickets 01 and 04 merged.

## Changes
- `test/extract.ts`:
  - New flag `--coverage`. After extraction, run `assessCoverage(llm, cv, jobProfile.requirements)` inside `timed("assessCoverage", …)`.
  - For each Requirement, print id, importance, text, verdict, Evidence IDs and reason. Then print the downgrade count and the score, rounded and unrounded (via `matchScore`).
  - `describeError` knows `CoverageError` and prints its issues.
  - Update `USAGE`.
- `--coverage --check`: besides the existing CV check, read `<job-description path without extension>.coverage.json` next to the Job Description. Format: `[{ "requirement": string, "verdict": "met" | "partially_met" | "unmet" }]`, validated with Zod.
  - Print one warning line per mismatch (`"<key text>": expected met, got partially_met (req3)`) and one per key entry that matches no Requirement.
  - These warnings never change the exit code. A CV `--check` mismatch still returns 1.
  - If `--check` is given without `--coverage`, the coverage key is ignored, as today.
- The comparison is a pure function, `compareCoverageToKey(requirements, coverage, key): string[]`, in `test/extractCheck.ts` or a sibling file. Match by normalized text: lower case, collapsed whitespace, and the key's text contained in the Requirement's text or the reverse. When several Requirements match, use the first in Job Profile order.

## Tests (test-first)
Extend `test/extract.test.ts` (or the check's own test file) for `compareCoverageToKey`:
- all match → no lines
- a verdict mismatch → one line naming both verdicts and the Requirement id
- a match in the reverse containment direction
- a key entry that matches nothing → one line

Use made-up Requirement texts only.

## Done when
`pnpm typecheck` passes and your test file passes. Running `pnpm --filter backend extract` with no arguments prints the new usage. One commit.
