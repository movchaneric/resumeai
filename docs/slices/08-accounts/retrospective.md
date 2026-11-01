# Retrospective: slice 8 (Accounts)

## What went well
- **Reviews caught real security gaps before merge.** Each was sent back to a Sonnet agent and fixed with a test:
  - Google could link into an unverified password Account, so `requireLocalEmailVerified` is now on and tested.
  - Reset tokens survived account deletion, so deletion now removes the verification rows too.
  - A Run's link was enough to claim it, against ADR 0009. That led to the claim token, which the owner chose.
- **Verifying by hand paid off.** Rerunning the suites, reading the diffs and running privacy-check before every push caught a supply-chain bypass (the `minimumReleaseAge` exclusion for a too-new Better Auth) and a privacy-check hit.
- **Fanning out the frontend worked.** One agent built the API and state layer first. Then two agents built the screens in parallel worktrees, and the merge needed only two small conflict fixes.

## What went badly
- **The privacy check matched again.** An agent used a word from the private-names list in a constant name, comments and a test, then reported privacy-check clean. Every commit after it had to be squashed. The brief already forbade the word; the agent ran the check before its last commit, not after it.
- **Both parallel agents created `test/helpers/account.ts`.** Shared test helpers need an owner in the brief.
- **There was no browser for the proof.** Claude in Chrome wasn't connected, so the in-app session proved the flow over HTTP through the Vite proxy, and the browser and Google parts went to the owner.
- **GitGuardian failed CI twice** on a dummy test password. Dismissing one occurrence left the incident open.

## Do differently
- In parallel briefs, give each shared file (test helpers, the router) to one agent, or create it before the fan-out.
- Ask agents to paste the exit code of `scripts/privacy-check.sh` run after their last commit, not before it.
- Check that Claude in Chrome is connected before the proof step, and tell the owner early if it isn't.
