# Coding standards

Judgement rules for code review, on top of the structure and import rules in `CLAUDE.md`. The rules in `CLAUDE.md` that a script can check are enforced by `backend/test/architecture.test.ts`; this file holds the ones a script cannot check.

## Tests

- **A test that asserts on stored state creates or clears that state itself.** It never relies on rows, checkpoints or files left by earlier runs or other tests. Seed what you read, or wipe it first and assert it was written. *Why:* in slice 4a, a checkpointer test passed against the wrong schema because it read tables left over from an earlier run.

## Parameters

- **A parameter is required when every caller passes it.** Make it optional, with a default, only when some real caller leaves it out. *Why:* reviews of slices 4a and 5a both found optional parameters with defaults that every caller supplied (`consecutiveEmptyRounds`; `userEvidence`, `confirmedGaps`, `onlyGapsLeft`). The default hides a missing argument from the type checker, so a new caller that forgets it gets silently wrong behaviour.
