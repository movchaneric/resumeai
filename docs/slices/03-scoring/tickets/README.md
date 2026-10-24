# Slice 3 tickets

Each ticket is a self-contained brief for one Sonnet session. Read the ticket, the files it names, the root `CLAUDE.md`, and the sections of [`../plan.md`](../plan.md) it points to. The reasons behind every choice are in [`../decisions.md`](../decisions.md).

## Order and parallel waves

| Wave | Tickets (parallel within a wave) | Waits for |
|---|---|---|
| 1 | [01 OpenAI settings](./01-openai-settings.md), [02 Pure scoring pieces](./02-pure-scoring-pieces.md) | nothing |
| 2 | [03 Run view and storage](./03-run-view-and-storage.md), [04 Coverage chain and spans](./04-coverage-chain-and-spans.md) | 02 |
| 3 | [05 Pipeline](./05-pipeline.md), [06 Dev script coverage](./06-dev-script-coverage.md) | 03 and 04 (05); 01 and 04 (06) |

After wave 1, the owner can run the model comparison (plan, manual check 2) while waves 2 and 3 are built.

## File ownership (why the waves don't collide)

| Ticket | Owns |
|---|---|
| 01 | `utils/config.ts`, `llm/langChainLlmClient.ts`, `index.ts` (only if the client options change), `test/utils/config.test.ts`, `test/llm/langChainLlmClient.test.ts`, `.env.example`, `test/extract.ts` (only the client construction, if its options change) |
| 02 | `prompts/renderCv.ts`, `scoring/weights.ts`, `scoring/matchScore.ts`, `scoring/coverageRules.ts`, `scoring/errors.ts`, their tests under `test/prompts/` and `test/scoring/`, `CLAUDE.md` (structure block only) |
| 03 | `shared/src/run-view.ts` and shared tests, Prisma schema and migration, `stores/runs.ts`, `services/runs.ts` (`toRunView` and its helpers only), `test/services/runs.test.ts` (view cases), `test/routes/runs.test.ts` (view cases) |
| 04 | `scoring/assessCoverage.ts`, `utils/spans.ts`, the `failure_reason` rename in `extraction/extractCv.ts` and `extraction/extractJobProfile.ts`, `test/scoring/assessCoverage.test.ts`, `test/extraction/spans.test.ts` |
| 05 | `services/runs.ts` (`runPipeline`, `failureCode`, messages), service and route tests for the pipeline, a pipeline span test, Postman |
| 06 | `test/extract.ts` (`--coverage`), `test/extractCheck.ts` (or a sibling) and its test |
| 07 (after the first manual run) | the Coverage prompt, key matching in `test/extractCheck.ts`, the failure log line |
| 08 | `utils/config.ts`, `services/runs.ts` (`RunsDeps.coverageLlm`, `runPipeline`), `index.ts`, `test/extract.ts`, `.env.example`, config and service tests |

## Rules for every ticket
- Follow the root `CLAUDE.md`: layers, `@/` imports with `.js`, constructor injection, no Prisma outside `stores/`, no LangChain outside `llm/` (and the one `utils/tracing.ts` exception).
- Work test-first where the ticket lists test cases.
- **Tests during a parallel wave:** all worktrees share the test database `resume_ai_test`. Run only your own test files (for example `pnpm --filter backend test test/scoring`) plus `pnpm typecheck`. The full `pnpm --filter backend test` runs once after the wave is merged. When a ticket runs alone, run the full suite.
- **Prove each new test can fail.** For a fix or rule, break the code on purpose, watch the test go red, restore it, and check with `git diff` that the restore really happened.
- One commit per logical change, messages ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push or open a PR.
- No test calls a model.
- **No real CV text anywhere:** not in fixtures, tests, comments, commit messages or your report. Never open or copy from `local-cvs/`. Use made-up people, companies and titles (`Acme Labs`, `Jane Doe`, `Software Engineer`).
- When done, report: what changed (commit hashes), the exact test commands and their results, anything that deviates from the ticket or is still unclear. An empty report is not acceptable.
