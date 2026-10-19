# Handoff: slice 1 done, next is slice 2

## Where things stand
- `POST /runs` takes a `cv` file (PDF or DOCX) and a `jobDescription` text field, parses the CV in memory, stores the plain text in `app.runs` and returns `201 { id }`. Rejections return `4xx { code, message }` and create no Run.
- `GET /runs/:id` returns a `RunView`. Every Run is parked at `extracting` (`parse` done, the other six steps pending) until slice 2 advances it. Unknown, malformed and expired IDs return `404 RUN_NOT_FOUND`.
- The backend is layered under `backend/src/` (`routes/`, `controllers/`, `services/`, `stores/`, `middleware/`, `parsing/`, `utils/`). The rules, including `@/` imports, are in the root `CLAUDE.md`.
- Decisions: `decisions.md` in this folder, ADR 0005 and the slice 1 addendum in ADR 0003. Review findings: `review-code.md`. What went wrong and how it was handled: `retrospective.md`.
- Tests: 33 backend (parsers, config, `RunsService` with a fake store, and `supertest` integration against `resume_ai_test`) and 26 shared. Postman: `postman/resume-ai.postman_collection.json` (11 requests; set Postman's working directory to the repo root).

## Next: slice 2, extraction (needs the LLM)
- The CV and Job Profile chains, ID assignment with date normalization, and the first Phoenix traces.
- It reads `cv_text` and `jd_text` from `runs` (transitional, ADR 0003 addendum), writes the structured result, and moves the Run past `extracting`. `toRunView` in `backend/src/services/runView.ts` must then stop hardcoding `extracting` and read the real status and step state.

## LLM for development: Ollama with Qwen3 14B (decided after slice 1)
No paid API key for now. Slice 2 runs against a local model:
- **Model:** `qwen3:14b` through Ollama (about 9 GB; fits the owner's M1 Pro with 16 GB). Fallback `qwen3:8b`. `.env.example` already points `OPENAI_BASE_URL` at `http://localhost:11434/v1/` with a dummy key; the OpenAI SDK requires a key but Ollama ignores it.
- **Turn thinking off** for extraction (`reasoning_effort: "none"` on the OpenAI-compatible endpoint) and use `temperature: 0`. Confirm both with the smoke test.
- **Smoke test against Ollama:** the open item about strict structured output (`additionalProperties`, the date `pattern`) must be checked against Ollama's `response_format` support, not OpenAI's. Zod validation of the result stays the real guard.
- **Seam:** put a small `LlmClient` interface in front of the SDK, so tests use a fake that returns canned, schema-valid output (like the fake store in `backend/test/services/runs.ts`). Automated tests never call a model.
- **Expect lower quality** than GPT-class models on the jumbled CV text; don't judge final quality or eval results from it.
- **At the end of the project** the owner will switch to a hosted model (OpenAI, Anthropic or Gemini). Keep model names and the base URL in config, not in code, so that is a config change.
- The owner's CV stays local; this is a single-user project, so sending it to a local model is fine.

## First task for slice 2: the CV text has a jumbled reading order
Found with the project owner's real two-column CV. `unpdf`'s `extractText` returns text in PDF storage order, not visual order:
- Sections come out in the wrong order (summary first, name and contact after).
- Dates are glued to the next line, for example a date range immediately followed by a job title, or "Graduated 2025" immediately followed by the institution.
- Headings are detached from their content, and a date range can land far from the entry it belongs to.

Dates and titles are exactly what must never change (ADR 0004), so a wrong guess would attach the wrong dates to a job. Options to decide in the grilling: rebuild column-aware reading order from `extractTextItems` (it returns x and y positions), or give the extractor both layouts. Keep a real-CV regression case out of git (the repo has `local-cvs/` in `.gitignore` for this).

## Open items
- Check that OpenAI strict structured output accepts the extraction schemas (`additionalProperties`, the date `pattern`) with one smoke call. `OPENAI_API_KEY` is not set yet.
- The CV template is still to come from the project owner.
- Environments and deployment haven't been designed.
- Known risks from `review-code.md`, needed before untrusted public traffic: expired Runs and their CV text stay in the database until the slice 5 sweep, and the 10-second parse timeout does not stop the work (parse in a killable worker, cap decompressed DOCX size).
- A DOCX over the character limit returns `TOO_MANY_PAGES`; revisit if the frontend needs to tell them apart.

## Practical notes
- Start Docker Desktop, then `docker compose up -d postgres`. The container is on host port **15432**, because a native Postgres on the owner's Mac already uses 5432. `.env.example` has the matching `DATABASE_URL`; copy it to `backend/.env`.
- Our table is `app.runs`: Prisma owns the `app` schema and the LangGraph checkpointer will get its own (ADR 0005). Migrations: `pnpm --filter backend db:migrate`; the test database is `resume_ai_test`.
- `pnpm --filter backend dev` starts the server, `pnpm --filter backend test` runs the tests, `pnpm --filter backend fixtures` regenerates the synthetic fixtures.
- Branch per slice, one PR each. Commit messages end with the Co-Authored-By line.
