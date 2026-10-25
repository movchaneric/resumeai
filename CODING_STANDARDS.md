# Coding standards

Judgement rules for code review, on top of the structure and import rules in `CLAUDE.md`. The rules in `CLAUDE.md` that a script can check are enforced by `backend/test/architecture.test.ts`; this file holds the ones a script cannot check.

## Tests

- **A test that asserts on stored state creates or clears that state itself.** It never relies on rows, checkpoints or files left by earlier runs or other tests. Seed what you read, or wipe it first and assert it was written. *Why:* in slice 4a, a checkpointer test passed against the wrong schema because it read tables left over from an earlier run.
