# Documentation

| Category | Where | What it holds |
|---|---|---|
| Domain language | [`CONTEXT.md`](../CONTEXT.md) (repo root) | Glossary of project terms. Kept at the root because the domain-modeling tooling looks for it there. |
| Decisions | [`adr/`](./adr) | Architecture decision records, numbered `NNNN-slug.md`. Only for decisions that are hard to reverse, surprising, and a real trade-off. Project-wide, so not split by slice. |
| Work by slice | [`slices/`](./slices) | Everything produced while working on one step of the build: plans, handoffs, reviews, notes. |

Package-level READMEs (for example `frontend/README.md`) stay next to their code.

## Where a new doc goes

Every plan, handoff, review or note belongs to the slice being worked on, in `docs/slices/<NN>-<slice-name>/`. Do not put files in `docs/` itself, and do not use generic names at the top level.

- Create the slice folder when work on that slice starts, not before.
- Use descriptive file names inside it: `plan.md`, `handoff.md`, `review-<topic>.md`, `notes-<topic>.md`.
- A handoff is written at the end of a slice and stays in that slice's folder. It describes the state and the next slice, which then gets its own folder and `plan.md`.
- A decision that outlives the slice becomes an ADR in `adr/` and is linked from the slice docs.

## Slices

| Folder | Scope | Status |
|---|---|---|
| [`00-scaffold-and-schemas`](./slices/00-scaffold-and-schemas) | Monorepo scaffold, shared Zod schemas, glossary, ADRs | Done |
| [`01-upload-parse-run-view`](./slices/01-upload-parse-run-view) | Config, `runs` table, PDF/DOCX parsing, `POST /runs`, `GET /runs/:id`, Postman collection | In progress |
| `02-llm-extraction` | CV and Job Profile chains, ID assignment, first Phoenix traces | Planned |
| `03-scoring` | Coverage chain, Match Score function | Planned |
| `04-graph` | LangGraph, checkpointer, questions interrupt, tailoring, validation, exit router, SSE, resume | Planned |
| `05-review-export-cleanup` | Per-Change review, DOCX/PDF export, TTL sweep, `DELETE /runs/:id` | Planned |
| `06-frontend` | Vite SPA | Planned |
