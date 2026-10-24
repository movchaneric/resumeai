# 07 Stricter Coverage prompt and word-based key matching

Found in the first manual run with gpt-4.1-mini (2026-10-24). The owner's CV scored 98: 28 of 29 Requirements came back met or partially met, and every Requirement the verdict key marked unmet came back met. The reasons show inference instead of proof:
- One reason claimed a bullet showed improvement "based on feedback and data". The bullet says nothing about feedback or data.
- Others reasoned "pioneered X, *indicating* ability to iterate quickly".
- Others restated the Requirement ("designed architectures, simplifying complex systems").

The Claim rule never fired. The model cited the skills list plus an unrelated bullet, which is enough to escape a code check.

Separately, 9 of 29 key entries matched no Requirement. The Job Profile words Requirements slightly differently each run ("Strong experience frontend development" vs "Strong frontend development experience"), so substring matching is too brittle.

## A. Stricter Coverage prompt (`backend/src/scoring/assessCoverage.ts`)

Change `COVERAGE_SYSTEM_PROMPT`. These are general rules, not tuned to any CV.
- Keep every existing rule.
- Replace the `met` rule with this meaning:
  - `met` needs at least one cited Item that **states** the Requirement directly: the same skill, technology, activity or outcome, in the Item's own words.
  - Each cited Item must itself support the verdict; never cite an Item that is unrelated to the Requirement.
- Add an inference rule: if the reason has to infer the Requirement from something else ("indicating", "suggests", "shows ability to", "implies"), the verdict is at most `partially_met`. If no Item states anything related, it is `unmet`.
- Add: "The reason may only describe what the cited Items say. Never add details that are not in them."
- Add: "Soft skills and ways of working (ownership, attention to detail, collaboration, iterating quickly) are `met` only when an Item describes that behaviour. Otherwise they are `partially_met` when an Item is related, or `unmet`."
- Add two short examples with **made-up** Items, in the prompt itself:
  1. Requirement "Experience with Kubernetes". Item `[exp2.b1] Deployed services to Kubernetes with Helm` gives `met`. Item `[exp2.b3] Improved deployment reliability` alone gives `partially_met`, because it is related but doesn't state it.
  2. Requirement "Iterate quickly and prototype". Item `[exp1.b4] Built an internal billing dashboard` gives `unmet`. "Built a dashboard" does not describe iterating or prototyping, and inferring it is not allowed.
- Keep the prompt compact. Use no real CV text: the examples above are fictional.

Tests: `test/scoring/assessCoverage.test.ts` gains one assertion that the system prompt sent to the model contains the inference rule and the "never add details" rule (match key phrases), so a later edit cannot silently drop them. Behaviour can't be unit-tested without a model; the owner checks it with the dev script.

## B. Word-based key matching (`backend/test/extractCheck.ts`)

Replace the substring match in `compareCoverageToKey`:
- Normalize both texts: lower case; replace every character that is not a letter, digit, `+` or `#` with a space; split into words.
- Drop stop words (a small fixed list: `a, an, and, or, the, of, to, in, on, for, with, like, at, by, from, into, as, is, be, when, needed`) and words of one character.
- A key entry's score against a Requirement is |shared words| ÷ |key words|.
- The key entry matches the Requirement with the highest score, if that score is at least 0.6. On a tie, the first in Job Profile order wins.
- Otherwise it is reported as unmatched (same line as today).

Tests in `test/extract.test.ts`, with made-up texts:
- reordered words match ("Strong experience frontend development" against "Strong frontend development experience")
- punctuation and extra words match ("Build, maintain, and scale modern web applications" against "Build, maintain and scale modern web applications, frontend and backend")
- below the threshold is unmatched
- the highest score wins over an earlier, weaker match
- the tie rule

Update the existing containment tests if they no longer describe the behaviour.

## C. Failure log wording (`backend/src/services/runs.ts`)

The safe failure log still reads `extraction failed` when Coverage fails. Change it to `Run <id>: pipeline failed (<code>) <name>, <n> issues`, and update the test that pins it. Nothing else in the log changes.

## Files you own
`backend/src/scoring/assessCoverage.ts`, `backend/test/scoring/assessCoverage.test.ts`, `backend/test/extractCheck.ts`, `backend/test/extract.test.ts`, `backend/src/services/runs.ts` (the log line only), and the test that pins the log line.

## Done when
`pnpm typecheck` and the full `pnpm --filter backend test` pass (Postgres up). Three commits (A, B, C), each ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
