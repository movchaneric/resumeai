# Handoff: next steps

## Where things stand
- The monorepo has `backend/` (Express 5, only `/health`), `shared/` (Zod schemas, 26 tests) and a placeholder `frontend/`.
- Docker Compose runs Postgres 17 and Phoenix.
- The glossary is `CONTEXT.md`, the decisions are `docs/adr/0001`–`0004`, and a summary is in the Obsidian vault under `Resume AI/`.
- `master` is the dev environment. PR #1 (shared schemas and docs) is merged.

## Next: slice 1, upload, parse, run view (no LLM needed)
- Add config loading, a Postgres connection and the `runs` table (id, status, timestamps, expiry, export path).
- Parse text from PDF and DOCX. Reject unsupported types, oversized files, too many pages and scanned PDFs, each mapped to a `RunErrorCode`.
- `POST /runs` takes a multipart upload of a CV and a Job Description, saves the files, inserts the row and returns the run ID.
- `GET /runs/:id` returns a `RunView` validated against `RunViewSchema`.
- Commit a Postman collection in `postman/` with real PDF, DOCX, scanned and oversized cases.

## Then, in order
- **Slice 2, extraction:** the CV and Job Profile chains, ID assignment with date normalization, and the first Phoenix traces.
- **Slice 3, scoring:** the Coverage chain and the Match Score function.
- **Slice 4, the graph:** LangGraph with the Postgres checkpointer, the questions interrupt, tailoring, two-stage validation, the exit router, SSE and the resume endpoint.
- **Slice 5, review and export:** per-Change review, DOCX/PDF export, the hourly TTL sweep and `DELETE /runs/:id`.
- **Slice 6, the frontend.**

## Open items
- Check that OpenAI strict structured output accepts the extraction schemas (`additionalProperties`, the date `pattern`) with one smoke call.
- The CV template is still to come from the project owner.
- Environments and deployment haven't been designed.
- The step keys, error codes and score weights are picks made while writing code and are easy to change.

## Practical notes
- pnpm 12 is installed globally. Run `pnpm approve-builds` if install blocks a build script. `pnpm --filter backend exec tsx` fails, so use `pnpm dev` or `npx tsx`.
- Start Docker Desktop before `docker compose up -d`.
- `OPENAI_API_KEY` isn't set yet. `.env.example` lists the variables.
- Branch per slice, one PR each. Commit messages end with the Co-Authored-By line.
