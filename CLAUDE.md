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
  routes/        index.ts mounts each feature's router and wires store -> service -> controller
  controllers/   the HTTP edge: read the request, call the service, set status and response. No business rules, no DB.
  services/      business rules. No Express (`req`/`res`). Throws `ApiError` to reject.
  stores/        data access (Prisma). Only stores import the Prisma client.
  middleware/    cross-cutting HTTP code (error handler, not-found)
  parsing/       CV file parsing (file to text, no model)
  extraction/    Extraction chains, ID assignment, verbatim check. Imports `LlmClient` and `@/utils/spans.js`, never LangChain.
  scoring/       Coverage chain, Match Score, weights. Imports `LlmClient` and `@/utils/spans.js`, never LangChain.
  tailoring/     Tailor chain, claim-check chain, stage-1 checks, `applyChanges`. Imports `LlmClient` and `@/utils/spans.js`, never LangChain or LangGraph.
  prompts/       pure renderers that turn the CV and Requirements into prompt text with IDs. Imports only shared types (`@resume-ai/shared`).
  graph/         the LangGraph Run graph, its thin nodes, the graph runner and the Postgres checkpointer. The only importer of LangGraph (`@langchain/langgraph*`); nodes call `extraction/` and `scoring/`, and the service sees the runner only through the `GraphRunner` interface it defines.
  llm/           the `LlmClient` interface and its LangChain implementation. Only `llm/` imports LangChain models (one exception below).
  utils/         config, db client, errors, tracing (`tracing.ts`), named spans (`spans.ts`)
backend/test/    mirrors src (routes/, services/, graph/, parsing/, prompts/, scoring/, tailoring/, utils/); fixtures live in test/fixtures
```

- `utils/tracing.ts` is the one file outside `llm/` that imports LangChain (`@langchain/core/callbacks/manager`, to instrument it). `utils/spans.ts` imports only the OpenTelemetry API and OpenInference semantic conventions, so any layer may use `withSpan`.
- Routers hold routes and transport middleware (multer) only, with no logic.
- `app.ts` builds the Express app; `index.ts` starts the server.
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

## Agent skills

### Issue tracker

GitHub Issues on `movchaneric/resumeai`, through the `gh` CLI. Specs and tickets are issues; slice docs stay in `docs/slices/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the root. See `docs/agents/domain.md`.
