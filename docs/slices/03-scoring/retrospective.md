# Slice 3 retrospective: what didn't go as planned

An honest log of the detours, kept for the project story. For each one: what happened, how it was handled, and whether it is actually fixed. The planned decisions are in `decisions.md`; the review findings are in `review.md`.

## How the work was split
The slice ran as ten tickets (`tickets/`), each a self-contained brief for a Sonnet agent. Tickets 01 to 06 ran in three parallel waves, in worktrees created by hand from the slice branch (slice 2's workaround, now in the project memory). Tickets 07 to 10 came after the manual run and the review. Opus planned, reviewed and wrote the docs; it wrote no code (`CLAUDE.md`, model split).

## Checks that proved nothing
**Opus's own "fails without the fix" checks were wrong twice.** Once it stashed a change that was already committed, so the stash held nothing and the test stayed green. Once its `sed` edited only a comment, not the code. Separately, an agent's `sed` used Linux (GNU) syntax, which macOS's `sed` does not accept.
- Handled: each was caught and the check redone properly.
- Status: **process fix.** Slice 2's lesson (check a revert with `git diff` before trusting red) was written down, but Opus didn't follow it itself. Lesson: confirm the break with `git diff` before the red run counts, every time, whoever runs it.

## The answer keys
**The CV answer key was named after an old CV filename.** The dev script looks for `<cv>.expected.json` next to the CV, so `--check` found no key for the current file.
- Handled: the key was copied to `eric_cv.expected.json`.
- Status: **fixed** (local only; `local-cvs/` is not in git).

**Matching the verdict key by substring was too brittle.** 9 of 29 key entries matched no Requirement, because the Job Profile words a Requirement slightly differently each run.
- Handled: ticket 07B matches by shared words.
- Status: **fixed.**

**The verdict key was written by Opus, not the owner.** It was built from the extracted CV and Job Profile, so `--check` measured agreement between two judges, not ground truth.
- Status: **open.** The owner should review it before it is used to judge prompt or model changes.

## Coverage judgement
**gpt-4.1-mini was too lenient, and prompt rules didn't fix it.** The first Coverage run scored 98. The reasons inferred proof ("…, indicating ability to iterate quickly") and once invented a detail ("based on feedback and data"). The Claim rule never fired, because the model cited the skills list plus an unrelated bullet. Ticket 07's stricter prompt moved it to 94, still inferring.
- Handled: Coverage moved to gpt-4.1 through a separate setting, `LLM_COVERAGE_MODEL` (ticket 08). It scored 65 to 70 with no inference reasons. Extraction stays on gpt-4.1-mini, because the verbatim check verifies its copy.
- Status: **fixed by the stronger model**, at about $0.011 more per Run.
- Lesson: measure judgement against a key early. The prompt was the cheap fix to try, but the model was the real one, and a key showed it within two runs.

**`unmet` verdicts cited Evidence.** The Postman run on a second job description had two `unmet` verdicts that cited the job and a skills entry. No structural check covered it.
- Handled: ticket 09 clears Evidence on every `unmet` in code.
- Status: **fixed.**

## Config
**The Ollama block in `.env.example` would have broken startup.** Ticket 08 asked for a commented `# LLM_COVERAGE_MODEL=` line. Uncommented, it sets an empty string, which `config.ts` rejects. The gap started in Opus's ticket text, not in the agent's code. The review found it (P2).
- Handled: ticket 10 replaced it with a comment saying to leave the setting unset.
- Status: **fixed.** Lesson: a ticket's example config line needs the same scrutiny as code.

## What went to plan
**The plan's promises all held.** Span names, `session.id`, the `score` and `coverage.*` attributes, the Run view rows and the error code were all present at the review. The manual run came before the review this time, so the gaps it found (leniency, Evidence on `unmet`) became tickets 07 to 09 before the reviewers looked. Slice 2's lesson worked.

**The move to OpenAI was mostly config,** as planned: one code change (optional `LLM_REASONING_EFFORT`), and the pipeline went from about 160 s on local Qwen to about 16 to 20 s.

## Review (details in `review.md`)
No hard violations and nothing blocking. The owner chose to fix S1 and P1 (docs), and P5, P2, S2, S3, S4 and S5 (code, ticket 10), and to keep P3, P4 and S6 to S10 as they are.

## Summary
Everything slice 3 set out to do works and is tested (220 backend, 30 shared): Coverage, the Match Score, the move to OpenAI and one `pipeline` trace per Run. What went wrong was mostly judgement and checking: a cheaper model that was too lenient for Coverage, a verdict key that is Opus's opinion rather than the owner's, and red checks (including Opus's own) that proved nothing until `git diff` confirmed the break. The remaining questions (Requirement count variance, responsibilities weighting, strictness) are open items in `handoff.md`.
