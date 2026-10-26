# Slice 5a decisions: Questions

Settled in a grilling session (2026-10-26). All decisions are owner-approved. Terms follow `CONTEXT.md`, which was updated in the same session.

Spec: [#30](https://github.com/movchaneric/resumeai/issues/30) "Slice 5a: Questions"; tickets #31 to #34 are linked from it.

## Scope
- **Slice 5 is split in two.**

  | Slice | Folder | Holds |
  |---|---|---|
  | 5a | `05-questions` | Questions, Answers, User Evidence, Confirmed Gaps. The client keeps polling. |
  | 5b | `05b-live-updates` | SSE and crash resume (`interrupted`) |

- Why: Questions are what unlock real tailoring gains (with CV support only, the claim check rejects nearly everything). SSE and crash resume are infrastructure that does not depend on them. Each half is about slice 3's size.
- Later, only if 5a leaves gains on the table: Questions driven by rejected Changes.

## The flow
```
extract → assess_coverage → questions ──(none to ask)──→ begin_round → … (as in slice 4a)
                              │
                              └─ interrupt: awaiting_answers ── POST /runs/:id/answers ──→ resume → begin_round
```
- **One pause, once, after the first Coverage and before tailoring.** The tailor has the facts from round 1. Rejected: asking after the rounds (needs rejected Changes, more pauses); both.
- When there is nothing to ask, the Run does not pause. When tailoring is skipped (everything met), there is nothing to ask either.
- After the resume, the work runs under a new root span with the same `session.id` (`withSessionSpan`).
- A Run left in `awaiting_answers` expires with its TTL like any other Run.

## Which Requirements get a Question
- **Must-haves whose verdict is `unmet` or `partially_met`, soft skills included**, ordered by weight (heaviest first, then Requirement order), **at most 5**.
- Why wider than "unmet must-have": #18 showed borderline `partially_met` verdicts and soft skills are exactly what the CV alone cannot settle. The cap keeps the user from facing 20 Questions.
- Each Requirement is asked about once per Run.
- **Question text is a template**, no LLM call: `The job asks for: <Requirement text>. Have you done this? Describe where and how.` Rejected for v1: an LLM-written Question (one more call and one more thing to validate; the Answer is what matters).

## Answers
- `has_experience` with text → **User Evidence**. `no_experience` → **Confirmed Gap**. A skipped Question records nothing (the Requirement keeps its verdict and is not a Gap). The user can skip each Question or all of them.
- Answer text is trimmed, must not be empty, and is at most **1,000 characters**.
- Answers are personal data like the CV: they live only in the checkpoint and are deleted with the Run (ADR 0002), and they stay off trace spans unless `TRACE_CONTENT` is on (ADR 0006).

## API
- `POST /runs/:id/answers` with `{ answers: Answer[] }`. Skipped Questions are left out; an empty list skips all.
- `202` and the graph resumes with `Command({ resume })`. The client keeps polling `GET /runs/:id`.
- `409` unless the Run is `awaiting_answers`. `400` for an unknown Question ID, a Question answered twice, or an invalid Answer. `404` as for `GET` (unknown or expired Run).
- `GET /runs/:id` in `awaiting_answers` returns the Questions (`RunView` already has the shape).

## User Evidence
- **It reaches the score only through Changes.** Coverage never cites User Evidence. The tailor uses it to reword or `add` Items, the Change is applied, and the re-judge sees the new Item text. Why: the Match Score measures the Tailored CV; a fact the employer never sees must not raise it.
- **"Trusted" means the fact is trusted, not the wording.** We never question whether an Answer is true. A Change that cites User Evidence still goes through stage-1 checks and the claim check, with the Answer text counted as Evidence like a CV Item, so the tailor cannot embellish beyond what the user said. Rejected: skipping the claim check for such Changes (it would let "I wrote some SQL" become "optimized queries at scale").
- The tailor's prompt lists User Evidence as `[ueN] (for reqM) <text>`. A Change may cite `ue` IDs. **`add` Changes built on User Evidence are allowed** (the main use: a bullet the CV left out); the tailor places it under the job the Answer names. Requirements with User Evidence are targeted first.
- Stage-1 "numbers are frozen": a number or date in the cited User Evidence may appear in `after`, as for cited CV Evidence.

## Confirmed Gaps
- Not targeted by the tailor and not asked about again.
- The exit router stops with `ceiling` when every must-have that is not met is a Confirmed Gap.
- The review summary lists them, so the user sees what they lack.
- The score is unchanged: the verdict stays as Coverage judged it.

## Delivery
- Branch `feat/slice-5a-questions`; tickets in worktrees from it.

  | Ticket | Holds | Depends on |
  |---|---|---|
  | 5a-1 | Question selection and template, pure, in `tailoring/questions.ts` | — |
  | 5a-2 | `questions` node with `interrupt()`, resume with Answers; state `userEvidence`, `confirmedGaps`; `GraphRunner.answer()`; `RunView` `awaiting_answers` | 5a-1 |
  | 5a-3 | `POST /runs/:id/answers` route, controller, service, validation; Postman entry | 5a-2 |
  | 5a-4 | Tailor, stage-1 checks and claim check use User Evidence; Gaps excluded from targeting; exit router `ceiling` on Gaps; review summary lists Gaps | 5a-2 |

- **Proof:** a manual Run on the owner's CV and job 1, answering 2 or 3 Questions: at least one Change citing User Evidence is accepted and the score rises.

## After implementation
Written at the end of the slice (2026-10-26).

### How it was built
- 4 tickets (#31 to #34), each done by a Sonnet agent in its own worktree, made from the slice branch. 5a-3 and 5a-4 ran in parallel after 5a-2.
- Opus checked each ticket by red-checking before a `--no-ff` merge. 5a-3 gained a real-Postgres test for `RunStore.claimStatus`, including a simultaneous claim.
- Review fixes in `01174a4` (`review.md`).

### Proof
- Run on the owner's CV and job 1, on `gemini-3.5-flash-lite` (the OpenAI account ran out of credits; see `retrospective.md`). The Run paused with 4 Questions; 2 were answered (duration and ownership).
- Result: `awaiting_review`, exit `ceiling` after 3 of 3 rounds. One Change was accepted, citing `ue2` (the ownership answer) for the "work independently and take ownership" Requirement. The score rose from **68 to 75**. No Change was made from the "2 years" answer to the "3+ years" Requirement, as expected.
- A duplicate submit got 409.
- The scores are not comparable with the gpt-4.1 numbers from #18; the proof checks the flow, not calibration.
