# Slice 2 retrospective: what didn't go as planned

An honest log of the detours, kept for the project story. For each one: what happened, how it was handled, and whether it is actually fixed. The planned decisions are in `decisions.md`; the review findings are in `review.md`.

## How the work was split
The slice ran as nine tickets (`tickets/`), each a self-contained brief for a Sonnet agent, run in parallel waves. Opus planned, reviewed and wrote the docs; it wrote no code (`CLAUDE.md`, model split).

**Agent worktree isolation branched from `master`, not from the slice branch.** The first parallel agents started without the slice's earlier commits.
- Handled: worktrees are now created by hand from the slice branch, then given to the agents (`pnpm install` and a shared build in each).
- Status: **worked around.** It is in the project memory for future slices.

**Two agents returned empty reports.** The work was done, but the final message said nothing about it, so the result had to be found from the diff and a test run.
- Handled: every agent result is checked by hand: rerun the tests, read the diff, and where a fix is claimed, prove the test fails without it.
- Status: **process fix**, not a tool fix.

**A "fails without the fix" check almost passed by accident.** An agent reverted its fix with `sed` to show the test going red. The `sed` silently matched nothing, so the test stayed green with the fix still in place. The agent noticed and redid the check properly.
- Lesson: a revert done to prove a test needs its own check (`git diff`) before the red run counts.

## Environment
**The first full test run was red, then green.** It was never reproduced. Later a similar single red run out of 12 was most likely two runs (Opus's and an agent's) sharing the test database at once.
- Status: **not explained.** The suspects are listed in `handoff.md`.

**The Ollama app restarted its server without our settings.** The macOS app runs its own `ollama serve` and ignores shell variables, so the 16k context window and the KV cache settings were silently lost, and Ollama used its 4096-token default.
- Handled: the settings are set with `launchctl setenv` (lost on reboot), and the run is checked with `ollama ps` before trusting a result.
- Status: **worked around.** The context guard cannot detect the mismatch (open item).

**Ollama rejected the CV schema** with `failed to parse grammar`: its regex converter does not support `\d`. Found by bisecting raw requests; fixed with `[0-9]` (`decisions.md`, smoke test findings).

## Things the tests didn't catch
**The model invented a month.** On the owner's CV, `2024- Present` came back as `2024-01`. The verbatim check proved only the year, so it passed.
- Handled: extracted months must now be proven by the source, with one retry telling the model to write the year alone. The review then widened the accepted forms (`Jun-2017`, year first, two-digit years).
- Status: **fixed.** English month names only.

**Heading drift.** A combined heading ("education and something else") went to `education` on one run and to an unprotected additional section on the next, with its dates as free text. The answer key caught it.
- Handled: a prompt rule sends a combined heading's entries to the typed section.
- Status: **fixed at the count level** on the owner's CV. Free-text additional sections remain an open item for slice 4.

**The plan's tracing promises were missed by all seven tickets.** The plan named the spans (`extract_cv`, `extract_job_profile`) and their attributes, but no ticket turned that into a task, and no test checked it. It showed up only in the manual API run, as LangChain's generic, unnested root spans.
- Handled: ticket 08 (named spans with `withSpan`), then 08b when the CV's model call nested under the Job Profile's span. LangChain runs callbacks on a background queue in the wrong async context; they now run inline.
- Status: **fixed and verified in Phoenix.** Lesson: when writing tickets from a plan, check every plan promise against a ticket line, and run the manual check before the review, not after.

**`TRACE_CONTENT=false` did not hide everything.** The review found that LangChain error spans carry model output in their exception event and status message, which OpenInference does not mask.
- Status: **fixed** (the exporter drops them when content is off), with a test that proves it.

## Private data
**A real CV line was committed in a test.** An agent turned the invented-month finding into a test case and copied the owner's real job title and employer into it. The review flagged it.
- Handled: with the owner's approval, the branch history was rewritten before the first push, folding the cleaned test into the original commit.
- Status: **fixed.** The branch was never pushed with it.

**Then Opus's own ticket leaked part of the same name.** Ticket 09's verify command, written to check the scrub, contained a fragment of the employer name. A second rewrite removed it. Later, the subagent's `review.md` was found to quote the full line too; it was cleaned before its first commit.
- Lesson: the rule is not only for agents' tests. Any brief, ticket, review or doc that refers to a real CV writes `<employer>` and types the real name only in the shell.
- For future briefs: "No real CV text in fixtures or tests; reproduce the shape with made-up names." Consider a pre-commit hook that greps staged changes for the names in `local-cvs/` (it would need to read the names from a gitignored file, never hold them itself).

## Review (details in `review.md`)
One must-fix (content in error spans), eight small items and four follow-ups. The owner chose the must-fix and every small code fix (ticket 09) plus the scrub. The four follow-ups are open items in `handoff.md`.

## Summary
Everything slice 2 set out to do works and is tested (148 backend, 27 shared), and an end-to-end run on the owner's real CV matched the answer key. What went wrong was mostly process: a plan promise no ticket carried, private text copied into a test (and then into Opus's own docs), and agent reports that could not be trusted without checking. Each now has a rule, in the docs or the project memory.
