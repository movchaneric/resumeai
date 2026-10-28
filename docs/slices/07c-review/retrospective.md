# Slice 7 retrospective: what didn't go as planned

This is an honest log of the detours in slice 7 (7a, 7b and 7c), kept for the project story. The planned decisions are in each part's `decisions.md`, and the state is in `handoff.md`.

## How the work was split
- **Design first:** a design pass came before any code, using UI UX Pro Max for the design system and Claude Design for the mockups. Then a grilling settled 28 questions in four rounds, and one docs PR (#78) carried the design system, the page specs and three `decisions.md` files.
- **Three parts:** 7a (backend) and 7b (frontend core) ran in parallel. 7c (Review) followed once both were merged.
- **Parallel tickets:** each ticket went to a Sonnet agent in a worktree made by hand from the slice branch. Within 7b, five screens ran at once. Within 7c, #75 and #76 ran at once against a written contract.
- **Model split:** Opus planned, reviewed, checked each result by hand (typecheck, tests, reading the diff) and wrote the docs. It wrote no code. When resolving a merge conflict meant editing code, it aborted the merge and handed it to a Sonnet integrator.

## The first design missed
- **What happened:** the owner found Direction A ("Classic") "ok… not what I expected" and asked for something "more modern, maybe more clean, with very good UX". Direction B (zinc and indigo, suggesting mode, focus mode on phones) was the second attempt.
- **What happened with the tooling:** UI UX Pro Max's raw output needed heavy curation. It suggested a landing-page pattern, fonts from a real-estate profile (Cinzel, Josefin Sans), and a teal-and-orange palette. Its Direction B palette was replaced.
- **What happened with the mockups:** they showed data the API doesn't return, such as "usually under a minute", a PDF page count, the Requirement name on Questions, and "Saves about 1 line". All of it was removed before the specs were written.
- **Lesson:** treat generated design output as raw material. Check every piece of mockup copy against the API before it reaches a spec.

## 7a: the ticket's guesses were wrong twice
- **"At most 4 renders":** the first binary search tried the floor size first. That capped the search at 4 renders, but a CV that fits at the normal size (the common case) then cost 4 renders instead of 1, which slowed every route that measures. It was sent back. Now the normal size is tried first, then the floor, then the search between them.
- **"Stub the measure in route tests":** the ticket assumed the services take a swappable fit-checking function. They don't, because `RunsService` and the graph call `fitOf` directly. The faster search alone took the route suite from 46.3s to 24.9s, so the stub was dropped.
- **Lesson:** a ticket's numbers and assumptions about the code are guesses. Check the common case and the actual shape of the code before accepting a "done".

## An agent waited 10 hours on nothing
- **What happened:** the #68 agent started a flake check with `cat > /tmp/... 2>/dev/null || ...; cat > $S/flake.sh <<EOF`. The heredoc belonged to the second `cat`, so the first one waited on stdin forever. The agent ended its turn "waiting for the flake check", and nothing moved overnight.
- **Handled:** the hung process was found with `ps`, and the agent was resumed with a one-heredoc script and a `trap` to clean up. Killing the hung `cat` was denied by the permission classifier, so the owner was asked to do it.
- **Lesson:** briefs now say "write the script once with a single heredoc, run it in the background, and never end the turn while it's pending". When an agent goes quiet, check its processes, not only its report.

## The privacy check, twice
- **A common word containing a private name:** the #68 commit used an ordinary English word (meaning "not specific") in a comment and a test name. The private-name check matches substrings, and that word contains a private name. It isn't spelled out here for the same reason. The agent reported the check clean, but it had run the check before committing, and the check scans commits, not the working tree. Because the check scans every commit's patch, a fix on top couldn't help. The commit was rewritten (fixup and autosquash), and the five screen tickets were cherry-picked onto the rewrite rather than merged, to keep the old commit out of history.
- **The merge commit:** pushing 7b to its remote branch, which had been created earlier at the old master, put master's merge commit for #79 into the hook's range. Its message, "Merge pull request #79 from <owner-handle>/…", matches the name. Deleting the stale remote branch was denied, so 7b went up under a new name, `feat/slice-7b-frontend`.
- **Lesson:** every code brief now bans the trigger words and says to run the check after committing. Slice branches are pushed for the first time only when the work is ready. A hook fix is a follow-up.

## Parallel agents and their seams
- **7b, five screens at once:** each lived in its own `features/` folder, so the only conflicts were in `RunScreen.tsx`, `screens.tsx` and tests that expected old headings. An integrator resolved them with cherry-picks.
- **7c, #75 and #76 at once against a contract:** the contract fixed the one shared file (the top bar's props) and who owns what. It worked, but it missed two seams:
  - **The rail's "Open checklist":** #75 wired it through a global `window` event, which was replaced with state held by the screen.
  - **Focus after `INVALID_REVIEW`:** the closing submit dialog returned focus to its button and stole it from the named card. That was found only when the two halves were joined.
- **A rule written twice:** #74 rewrote the backend's three re-judge sets by hand in the browser. They were correct, but it was the same drift risk that 7a had just removed for the drop rules. The helpers moved to `shared/src/rejudge.ts` before the screens were built on them.
- **Lesson:** a contract should list every cross-boundary interaction (open this, focus that), not just the props. Rules the client must agree with the server on go to shared the first time.

## The browser found what the tests didn't
Every browser check found something.
- **7b:**
  - **The round number was one too high:** `iterations.used` counts rounds started, but the Progress screen read it as rounds finished, so it showed "Round 2 of 3" during round 1. The test fixtures had encoded the same misreading.
  - **The Run header wrapped at 375px.**
- **7c:**
  - **The bullet marker was on the wrong line:** the native list marker aligns to the last line of an inline-block.
  - **Two headers:** the app shell's Run actions showed above the Review top bar's own.
- **7c, a product gap:** a Run whose CV can't fit even at its shortest was accepted at submit as 6c designed. It then ended on Done with both downloads refused, under copy that promised "Download it anyway as Word". The owner chose to allow the Word download. The completed view gained `onePage`.
- **A false alarm of my own:** during the 7b check the screen showed "Lost connection". The cause was a `shared` build left over from the 7a branch in the main checkout: master's backend required `originalCv` without sending it, and returned 500s. Rebuilding `shared` fixed it, and the fallback path got a real test by accident.
- **Lesson:**
  - Fixtures written from the same misunderstanding as the code prove nothing. Check field meanings against the backend source.
  - jsdom can't see layout. Keep a browser pass per slice, and add Playwright.
  - Rebuild `shared` after every branch switch.

## The proof didn't reach "Fits"
- **What happened:** the 7c proof aimed to bring the long CV under one page by drops and rejections, then download a one-page PDF. Run 1 was not fittable at all. On Run 2, a single 2-line drop left `overByLines` at 8, so getting under one page would have taken many decisions, and the check stopped short.
- **Status:** recorded as not reached, with the fits path covered by tests. The coarse measure is a follow-up.

## Housekeeping
- **Servers left running:** leftovers from earlier sessions were still up, among them a `pnpm dev` with a one-minute TTL (from an earlier TTL test) and a stray Vite. They had to be found and stopped before the browser checks. Some stops needed the owner.
- **A loop bug of my own:** a zsh `for` loop with `set -- $t` didn't split words, so the first attempt at creating the five 7b worktrees failed. It was redone with `${pair%%:*}`.
- **Cleanup:** the worktrees were removed after #81. Ten ticket branches stayed behind, because cherry-picks don't count as merged. Their content is in master in rewritten form, and deleting them needs `git branch -D` by the owner.
