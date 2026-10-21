# Slice 2 tickets

Each ticket is a self-contained brief for one Sonnet session. Read the ticket, the files it names, the root `CLAUDE.md`, and the sections of [`../plan.md`](../plan.md) it points to. The reasons behind every choice are in [`../decisions.md`](../decisions.md).

## Order and parallel waves

| Wave | Tickets (parallel within a wave) | Waits for |
|---|---|---|
| 1 | [01 Cleanup and error codes](./01-cleanup-and-error-codes.md), [02 PDF reading order](./02-pdf-reading-order.md) | nothing |
| 2 | [03 Config, LlmClient, tracing](./03-config-llm-client-tracing.md) | 01 |
| 3 | [04 Job Profile extraction](./04-job-profile-extraction.md), [05 CV extraction](./05-cv-extraction.md) | 03 (and 02 for 05) |
| 4 | [06 Run storage and extractRun](./06-run-storage-and-extract-run.md), [07 Dev script](./07-dev-script.md) | 01, 04, 05 (06); 04, 05 (07) |

03 may start while 02 is still running: they touch different files.

## File ownership (why the waves don't collide)

| Ticket | Owns |
|---|---|
| 01 | `shared/src/common.ts`, `shared/src/run-view.ts`, `backend/src/utils/errors.ts`, `services/runs.ts`, `controllers/runs.ts`, `stores/runs.ts` (types only), `routes/index.ts`, `app.ts`, `routes/runs.test.ts`, `services/runs.test.ts`, Postman; three one-line code renames in `parsing/parseCv.ts` |
| 02 | `parsing/parseCv.ts` (`parsePdf` only), `parsing/pdfLayout.ts`, `test/parsing/*`, `test/make-fixtures.ts`, `test/fixtures/*` |
| 03 | `utils/config.ts`, `utils/tracing.ts`, `llm/*`, `extraction/errors.ts`, `index.ts`, `backend/package.json` (dependencies), `test/utils/config.test.ts`, `test/llm/*`, `test/fakes/fakeLlmClient.ts` |
| 04 | `extraction/extractJobProfile.ts`, `test/extraction/extractJobProfile.test.ts` |
| 05 | `extraction/extractCv.ts`, `extraction/assignIds.ts`, `extraction/verbatim.ts` and their tests |
| 06 | Prisma schema and migration, `stores/runs.ts`, `services/runs.ts`, `app.ts`, `routes/index.ts`, `index.ts` wiring, route and service tests, Postman |
| 07 | `test/extract.ts`, the `extract` script in `backend/package.json`, `.env.example` |

## Rules for every ticket
- Follow the root `CLAUDE.md`: layers, `@/` imports with `.js`, constructor injection, no Prisma outside `stores/`, no LangChain outside `llm/`.
- Work test-first where the ticket lists test cases.
- **Tests during a parallel wave:** all worktrees share the test database `resume_ai_test`. Run only your own test files (for example `pnpm --filter backend test test/extraction`) plus `pnpm typecheck`. The full `pnpm --filter backend test` runs once after the wave is merged. When a ticket runs alone, run the full suite.
- One commit per logical change, messages ending with the Co-Authored-By line. Do not push or open a PR.
- No test calls a model. No real CV goes into git (`local-cvs/` is gitignored).
- When done, report: what changed, test results, anything left unclear or deviating from the ticket.
