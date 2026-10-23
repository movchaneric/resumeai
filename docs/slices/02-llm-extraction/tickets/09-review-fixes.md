# 09 Review fixes and the CV-line scrub

From the branch review in [`../review.md`](../review.md). The owner chose: fix the must-fix item and all small code items before the PR, and remove a real CV line from the branch history. Doc items (review 5 and 8) are done by Opus, not in this ticket. Review 10 to 13 are follow-ups for the handoff.

Do part A first and alone, because it rewrites history. Then part B, one commit per item.

## A. Scrub the real CV line from the branch history (review 6)

`backend/test/extraction/verbatim.test.ts` lines 124 to 161 use the owner's real job title and employer (the company name appears 7 times). It came in with commit `3aa720a` (after the scrub, the cleaned commit is `aaca51b`). No later commit touches that file, and the branch is not pushed.

1. Make a local safety ref: `git tag backup/pre-scrub HEAD`. It is local only; never push it.
2. Replace the company with a made-up one (for example `Acme Labs`) and the title with a generic one (for example `Software Engineer`) everywhere in that file. Keep each test's meaning: the dates and month forms stay exactly as they are. Rename any test label that says "real CV" to describe the case instead (for example "a year range with a spaced dash").
3. `git commit --fixup=3aa720a`, then `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash 3aa720a~1`. The editor is set to a no-op, so this runs without prompting. Commits after `3aa720a` don't touch the file, so no conflicts are expected. If there is one, `git rebase --abort` and report.
4. Verify, with the employer name typed in the shell only and never written to a file: `git log -p master..HEAD | grep -ci <employer>` prints `0`, `git grep -i <employer>` finds nothing, and `git diff backup/pre-scrub HEAD --stat` shows only `verbatim.test.ts`. Run the backend tests.

## B. Code fixes

### B1. No content in error spans when `TRACE_CONTENT=false` (review 1, must fix)
- OpenInference records `span.recordException(run.error)` and `setStatus({ message: run.error })` on every failed LangChain run, unmasked (`tracer.js:74-79` in `@arizeai/openinference-instrumentation-langchain`). `run.error` can contain model output (invalid-JSON `SyntaxError` messages quote it; `StructuredOutputParser` errors include all of it).
- In `utils/tracing.ts`, when `traceContent` is false, wrap the exporter (or add a span processor) so exported spans have no `exception` events and no status message. Status code stays (ERROR stays ERROR). With `traceContent` true, export as now.
- Structure it so the test can use the same wrapping with an in-memory exporter (the way `instrumentLangChain` is shared today).
- Test in `test/utils/tracing.test.ts`: `traceContent: false`, a fake fetch returning a body whose message content is not valid JSON and contains a marker string (for example `SECRET-MARKER`). The call fails. Assert that no exported span's attributes, event names or attributes, or status message contains the marker, and that at least one span has status ERROR. Confirm the test fails without the wrapping, then passes.

### B2. Months written with `-` or `/`, and year-first names (review 3)
In `extraction/verbatim.ts` (around lines 38 to 42), the month-name proof also accepts `Jun-2017`, `Jun/2017`, `Jun.2017`, and year-first forms such as `2017 Jun` and `2017-Jun`. decisions.md already says "the same with the year first or last". Add these to the `it.each` list in `verbatim.test.ts`, and keep the negative cases (`2017-061`, `12017-06`, a month next to a different year) failing.

### B3. Two-digit years (review 2)
In `extraction/verbatim.ts` (around lines 62 to 67), a four-digit year in the extraction is also proven when the source shows its two-digit form as part of a date: `MM/YY` (`03/21`), `Mon 'YY` / `Mon' YY` / `'YY` with an apostrophe (`Mar '21`, `'21`), or `Mon-YY` (`Mar-21`). A bare `21` alone does not count. A month extracted from `03/21` counts as proven (month `03`). Tests for each accepted form, plus a bare `21` that must still fail.

### B4. Flush spans on shutdown (review 4)
`index.ts` keeps the provider returned by `setupTracing` and, in the SIGINT/SIGTERM handler, awaits `provider?.shutdown()` before `prisma.$disconnect()`. Shutdown must still exit if the flush fails or Phoenix is down: catch it and keep going. No test is needed for `index.ts`.

### B5. Correct the misleading log comment (review 9)
`services/runs.ts:98` says "the error messages never carry the CV text". Change the log so it can't leak: log `Run <id>: extraction failed (<code>)` plus `error.name` and, for errors with `issues`, the issue count only. Not the message, not the issues, not the stack. Update the comment to say why. Adjust any service test that asserts on the log.

### B6. Missing tests (review 7)
- `services/runs.ts`: one test using the real default background runner (no injected one) with a store whose `saveExtraction` and `markFailed` throw. The process must not get an unhandled rejection, and the test waits for the work to settle.
- `llm/langChainLlmClient.ts`: one test whose fake fetch never resolves (or honours the abort signal) with `timeoutMs` of a few ms. It must throw `LlmUnavailableError`.
- `llm/langChainLlmClient.ts`: one test for the `parsed == null` / `parsingError` branch, which throws `LlmSchemaError`. Pick a fake response that really reaches that branch; if none can, say so in the report.

## Rules
- Root `CLAUDE.md`. Test-first for B1, B2, B3 and B6.
- Don't touch `docs/` except committing this ticket file with part B's first commit. Leave `review.md` and any other uncommitted doc alone.
- Never read or print anything under `local-cvs/`. Don't start servers or call a model.
- Each commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Don't push.

## Done when
- Part A's checks all pass.
- `pnpm typecheck`, `pnpm --filter backend test` and `pnpm --filter @resume-ai/shared test` are green.
- The report lists the new commit hashes, the before and after test counts, and how B1's test failed without the fix.
