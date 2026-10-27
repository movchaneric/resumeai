# Documentation

| Category | Where | What it holds |
|---|---|---|
| Domain language | [`CONTEXT.md`](../CONTEXT.md) (repo root) | Glossary of project terms. Kept at the root because the domain-modeling tooling looks for it there. |
| Decisions | [`adr/`](./adr) | Architecture decision records, numbered `NNNN-slug.md`. Only for decisions that are hard to reverse, surprising, and a real trade-off. Project-wide, so not split by slice. |
| Work by slice | [`slices/`](./slices) | Everything produced while working on one step of the build: plans, handoffs, reviews, notes. |

Package-level READMEs (for example `frontend/README.md`) stay next to their code.

## Where a new doc goes

Every decision record, handoff, review or note belongs to the slice being worked on, in `docs/slices/<NN>-<slice-name>/`. From slice 4a on, the spec (plan) and tickets are GitHub issues instead (see [`agents/issue-tracker.md`](./agents/issue-tracker.md)); slices 0 to 3 keep their `plan.md` and `tickets/`. Do not put files in `docs/` itself, and do not use generic names at the top level.

- Create the slice folder when work on that slice starts, not before.
- Use descriptive file names inside it: `decisions.md`, `handoff.md`, `review.md`, `retrospective.md`, `notes-<topic>.md`.
- A handoff is written at the end of a slice and stays in that slice's folder. It describes the state and the next slice, which then gets its own folder and spec issue.
- A decision that outlives the slice becomes an ADR in `adr/` and is linked from the slice docs.

## Slices

| Folder | Scope | Status |
|---|---|---|
| [`00-scaffold-and-schemas`](./slices/00-scaffold-and-schemas) | Monorepo scaffold, shared Zod schemas, glossary, ADRs | Done |
| [`01-upload-parse-run-view`](./slices/01-upload-parse-run-view) | Config, `runs` table, PDF/DOCX parsing, `POST /runs`, `GET /runs/:id`, Postman collection | Done |
| [`02-llm-extraction`](./slices/02-llm-extraction) | PDF reading order, CV and Job Profile chains, ID assignment, verbatim check, first Phoenix traces | Done |
| [`03-scoring`](./slices/03-scoring) | Coverage chain, Match Score, move to OpenAI, `pipeline` trace per Run | Done |
| [`04-tailoring-loop`](./slices/04-tailoring-loop) | LangGraph and checkpointer; tailor → validate → re-judge → exit router; `awaiting_review`; drop the transitional columns | Done |
| [`18-score-stability`](./slices/18-score-stability) | Fix for #18: cached Job Profile, Soft Skill kind, Coverage votes | Done |
| [`05-questions`](./slices/05-questions) | 5a: Questions and Answers interrupt, User Evidence, Confirmed Gaps | Done |
| [`05b-live-updates`](./slices/05b-live-updates) | 5b: SSE live updates, crash resume (`interrupted`) | Done |
| [`06a-review-cleanup`](./slices/06a-review-cleanup) | 6a: Review (one final decision per Change), P6 fix, `DELETE /runs/:id`, TTL sweep | Done |
| `06b-export` | 6b: DOCX/PDF export of the Tailored CV | Planned |
| `07-frontend` | Vite SPA, starting with a Claude Design pass (owner's request) | Planned |
