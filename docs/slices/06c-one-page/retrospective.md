# Slice 6c retrospective: what didn't go as planned

An honest log of the detours, kept for the project story. The planned decisions are in `decisions.md` and the review findings in `review.md`.

## How the work was split
- A grilling settled the open details of the 6b outline in four rounds (26 questions), then came one spec and four tickets (#54 to #58).
- Each ticket was a self-contained brief for a Sonnet agent, in a worktree made by hand from the slice branch. #56 and #57 ran in parallel after #55, and #58 followed.
- Opus planned, reviewed and wrote the docs; it wrote no code (`CLAUDE.md`, model split).
- Each ticket's diff was read, the tests rerun, and the new tests shown failing with the ticket's source put back.

## Ticket reviews caught real bugs
- **#55: a job could end with no bullet.** The last-bullet rule counted tailor-added bullets as staying, so a job with one original and one added bullet could lose the original. Then a rejected `add` in Review would leave it empty. Fixed: only original bullets count.
- **#55: no Coverage meant nothing cited.** Without Coverage, stage 1 treated nothing as cited. Fixed: a `remove` checked without Coverage is rejected.
- **#57: a layer slip.** `graph/` imported `fitOf` from `export/`. Fixed through `measureCondense` in `tailoring/`.
- **#58: the minimal CV wasn't minimal.** It accepted rewordings that lengthen a bullet, which the user could reject, so a fittable Run could be judged not fittable. Fixed.
- Lesson: reading the core diff against the rules in `decisions.md` found more than the agents' own test runs did. Keep reading diffs.

## A 6b bug found by a 6c agent
- **What happened:** the Condensing agent noticed that `renderPdf`'s overflow reported the total content height, not the height past page one. "Lines over" was about a page too high (85 instead of 26 on the fixture). 6b's tests only checked that a too-long CV reported some overflow, never how much.
- **Handled:** fixed in #57, with a test that removing `ceil(overflow / item height)` items fits.
- **Lesson:** a number that a model or a user acts on needs a test of its value, not only its sign.

## An agent dropped out mid-task
- **What happened:** the #58 fix agent stopped on a network error (`ENOTFOUND`) during its flake check. Its fix was already committed. The flake check died with it.
- **Handled:** the state was checked first (commits, worktree, leftover processes), the fix verified by hand, and the flake check rerun from the main session.
- **Status:** process lesson. After an agent stops early, check what it left before re-delegating.

## Slow tests
- **What happened:** the `reviewFit` route test renders real PDFs for every preview and view read. One flake check took 21 minutes. One agent cut it to 5 runs on its own; the full 20 was rerun.
- **Status:** follow-up open (stub the measure in route tests; binary-search `measureFit`).

## The proof Run
- **What happened:** the first proof Run disappeared mid-extraction (404). The long-running `pnpm dev` had `RUN_TTL_DAYS=0.0007` and `SWEEP_INTERVAL_MS=20000` exported, left from a TTL test, so the sweep deleted the Run after a minute. The `listening` line doesn't show TTL settings, so it wasn't visible there.
- **Handled:** a second server on port 3001 with clean settings; the owner's server was left alone.
- **Status:** process lesson, written into the handoff (check `env` before a proof Run). A possible follow-up: print the TTL and sweep interval on the `listening` line.
- **What went to plan:** on the long CV, Condensing ran its full limit and left the CV 9 lines over. That exercised `fittable`, the 400 `CV_TOO_LONG`, the drop rules, the preview and `final_rejudge`, all in one Run. The PDF read back as one page.

## Review
- The two-axis `/code-review` found no broken guarantee. The Standards findings were mostly optional parameters every caller passes, and duplicated bullet walks; both were fixed in one Sonnet pass.
- One accepted gap: the page check on `add`s can reject every `add` and still leave the draft over, when the round's `replace`s lengthened it. Condensing catches it afterwards.
