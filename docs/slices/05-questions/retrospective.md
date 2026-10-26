# Slice 5a retrospective: what didn't go as planned

An honest log of the detours, kept for the project story. The planned decisions are in `decisions.md`; the review findings are in `review.md`.

## How the work was split
Four tickets (#31 to #34), each a self-contained brief for a Sonnet agent, in worktrees made by hand from the slice branch. 5a-3 and 5a-4 ran in parallel after 5a-2. Opus planned, reviewed and wrote the docs; it wrote no code (`CLAUDE.md`, model split). Each ticket's diff was read and its behaviours were broken on purpose to confirm the tests catch them.

## The proof Run
**The OpenAI account ran out of credits mid-proof.** The first real Run paused correctly with 5 Questions; after the resume, round 1 failed with `LlmUnavailableError`. The cause (`insufficient_quota`) was in the error message, but the pipeline logs only the class name, so finding it took a long hunt.
- Handled: the owner chose not to add credits; the proof moved to Gemini's free tier through its OpenAI-compatible endpoint (`.env` only, no code change).
- Status: **follow-up open** (log the failure detail without content).

**Gemini's free tier was congested.** `gemini-2.5-flash` returned 404 ("no longer available to new users"); `gemini-3.8-flash` and `3.7-flash` timed out; `gemini-3.5-flash` and `flash-latest` returned 503 ("high demand"). A throwaway script that ran the real extraction code on made-up text showed the 503 hidden behind `LlmUnavailableError`, and that `gemini-3.5-flash-lite` handles our strict schemas in about 1 s.
- Handled: switched both models to `gemini-3.5-flash-lite`; the proof passed.
- Status: **follow-up open** (retry 503/429: with `maxRetries: 0`, one transient error fails a whole Run).
- Lesson: when a provider fails, test the real call path with made-up input first; it shows the actual error in one step.

**Shell state and tooling slips.** The first answers POST went out with an empty `$RUN`, because it ran in a different terminal. The handoff's `jq '.[0].error // …'` filter breaks when the response is an object, not a list.
- Handled: proof commands run in one shell; the filter became `if type=="array" then .[0].error else … end`.
- Status: **fixed** (process).

**Opus misreported an interrupted step.** The owner stopped the "submit answers and wait" command; Opus said no Answers had been sent. The POST had already gone out; only the wait was cut. The owner's resend got 409, which exposed it.
- Status: **process lesson.** After an interrupted command, check the state (`GET /runs/:id`) before saying what did or didn't happen.

**The Question IDs moved between models.** The new model's Job Profile produced 4 Questions instead of 5, so the saved ownership answer for `q5` had to go to `q4`.
- Handled: a copy with the ID remapped; the answer texts were unchanged.

## Review
- One reviewer finding (empty rounds ignore `onlyGapsLeft`) did not hold up on checking and was dropped.
- The fix agent's refactor left an unused `store` binding in two methods; typecheck does not flag it. Caught on reading the diff and removed by a second Sonnet pass.

## What went to plan
- The interrupt and resume worked first time on a real Run, including the session span and the 409 on a double submit.
- The proof met its bar: one Change citing User Evidence (the ownership answer) was accepted, the score rose from 68 to 75, and no Change was invented from the "2 years" answer to a "3+ years" Requirement.
