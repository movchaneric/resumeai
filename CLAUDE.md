# Resume AI: project rules

See `CONTEXT.md` for the domain language, `docs/README.md` for where docs go, and `docs/adr/` for decisions.

## Model split (HARD RULE, no exceptions)

- **Opus 5.5** (`claude-opus-5-5`) handles discussion, questions, design, planning and review. It may write docs (plans, handoffs, reviews, ADRs, `CONTEXT.md`, this file), but it must never write or edit code.
- **Sonnet 5.5** (`claude-sonnet-5-5`), and ONLY Sonnet 5.5, implements code: anything under `backend/`, `frontend/`, `shared/`, tests, configs, migrations, package files and scripts.
- When the session runs on Opus and code needs writing, hand the work to a subagent with `model: "sonnet"` and a self-contained brief (the plan, files to touch, rules from this file, commands to run). Do not edit code in the Opus session, not even a one-line fix.
- Opus reviews the Sonnet agent's result and sends fixes back to a Sonnet agent; it does not patch the code itself.
- If the session is already running on Sonnet 5.5, implement directly.

## Backend structure

Organise `backend/src` by layer, one folder per layer, with one file per feature in each (`runs.ts` in each folder for Runs). File names are camelCase.

```
backend/src/
  routes/        index.ts mounts each feature's router and wires service -> controller -> router
  controllers/   the HTTP edge: read the request, call the service, set status and response. No business rules, no DB.
  services/      business rules. No Express (`req`/`res`). Throws `ApiError` to reject.
  stores/        data access (Prisma). Only stores import the Prisma client.
  middleware/    cross-cutting HTTP code (error handler, not-found)
  parsing/       CV file parsing (file to text, no model)
  extraction/    Extraction chains, ID assignment, verbatim check. Imports `LlmClient` and `@/utils/spans.js`, never LangChain.
  scoring/       Coverage chain, Match Score, weights, exit router (`exitRouter.ts`). Imports `LlmClient` and `@/utils/spans.js`, never LangChain.
  tailoring/     Tailor chain, claim-check chain, stage-1 checks, `reviewProblem`, the removable-bullet rule and Condensing. Imports `LlmClient`, `@/utils/spans.js` and `fitOf` from `export/`, never LangChain or LangGraph. The pure CV and drop-rule helpers (`applyChanges`, `cvItems`, `applyDecisions`, `keptChanges`, `userDrops`, `dropProblem`) live in `shared/` so the browser uses the same rules.
  prompts/       pure renderers that turn the CV and Requirements into prompt text with IDs. Imports only shared types (`@resume-ai/shared`).
  graph/         the LangGraph Run graph, its thin nodes, the graph runner and the Postgres checkpointer. The only importer of LangGraph (`@langchain/langgraph*`); nodes call `extraction/`, `scoring/` and `tailoring/`, and the service sees the runner only through the `GraphRunner` interface it defines.
  export/        the Tailored CV as a file, built in memory: layout (CV to page blocks), the size table, the PDF renderer (PDFKit), the DOCX renderer (docx) and `measureFit` (shrink to one page) and `fitOf` (fits, or lines over). No model, no DB, no Express. Imports only shared types, `pdfkit`, `docx` and node built-ins. The service calls it for downloads; `tailoring/` calls `fitOf` to keep the Tailored CV on one page.
  llm/           the `LlmClient` interface and its LangChain implementation. Only `llm/` imports LangChain models (one exception below).
  utils/         config, db client, errors, tracing (`tracing.ts`), named spans (`spans.ts`), the in-process Run event bus (`runEvents.ts`), server shutdown (`shutdown.ts`), the open-stream registry it uses (`openStreams.ts`) and the TTL sweep timer (`sweepScheduler.ts`)
backend/test/    mirrors src (routes/, export/, services/, graph/, parsing/, prompts/, scoring/, tailoring/, utils/); fixtures live in test/fixtures
```

- `utils/tracing.ts` is the one file outside `llm/` that imports LangChain (`@langchain/core/callbacks/manager`, to instrument it). `utils/spans.ts` imports only the OpenTelemetry API and OpenInference semantic conventions, so any layer may use `withSpan`.
- Routers hold routes and transport middleware (multer) only, with no logic.
- `app.ts` builds the Express app; `index.ts` starts the server. `index.ts` builds the `RunsService` and passes it to `createApp`, because startup recovery (`recoverRuns`) needs the same instance; tests let `createApp` build it.
- Dependencies come in through constructors so each layer can be tested alone (a service test uses a fake store; routes are tested with `supertest`).

## Imports

- Inside `backend/src` and `backend/test`, import src code with the `@/` alias, never with relative paths: `import { ApiError } from "@/utils/errors.js"`.
- Keep the `.js` extension (NodeNext module resolution requires it, even for aliased imports).
- Do not use `@/` for other packages: shared code comes from `@resume-ai/shared`.
- `pnpm build` runs `tsc-alias` to rewrite `@/` in the compiled output. Don't add other alias prefixes.

## Workflow

- One branch and one PR per slice. Commit messages end with the Co-Authored-By line.
- Specs and tickets are GitHub issues (see `docs/agents/issue-tracker.md`); decisions, reviews, handoffs and retrospectives go under `docs/slices/<NN>-<name>/`, and `decisions.md` links the slice's spec issue.
- Run `pnpm typecheck` and `pnpm --filter backend test` (needs `docker compose up -d postgres`) before committing.
- CI (`.github/workflows/ci.yml`) runs typecheck and the shared and backend tests on every PR. `backend/test/architecture.test.ts` enforces the layer and import rules above, so a broken rule fails CI.
- Create ticket worktrees with `scripts/worktree.sh add <NN> <name>`; it branches from the current branch, copies `backend/.env`, installs, and builds shared. Each checkout uses its own test database, named after its folder; `remove <NN>` drops it, and `prune-dbs` lists leftovers.
- A failed Run's cause is in the server log: `pnpm dev` also writes it to `backend/logs/dev.log`. Read that before diagnosing. Its `listening` line shows the model settings in use; an exported shell variable overrides `backend/.env`.
- Manual proof Runs go through `scripts/proof-run.sh` (one shell, polls, prints the result); run it with `--help` for usage.
- Husky hooks (`pnpm install` sets them up): `pre-commit` builds shared and runs `pnpm typecheck`; `post-merge`/`post-checkout` run `prisma generate` when the schema changed; `pre-push` blocks commits that contain a name from `local-cvs/.private-names` (by hand: `scripts/privacy-check.sh`). Tests are left to CI. Don't skip a hook with `--no-verify` unless the owner asks.
- Check a new async test file for flakiness with `scripts/flake-check.sh <file>` before committing.
- Code review also checks `CODING_STANDARDS.md`.

## Agent skills

### Issue tracker

GitHub Issues on `movchaneric/resumeai`, through the `gh` CLI. Specs and tickets are issues; slice docs stay in `docs/slices/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
