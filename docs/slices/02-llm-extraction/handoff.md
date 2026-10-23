# Handoff: slice 2 done, next is slice 3

## Where things stand
- `POST /runs` parses the CV, stores the Run, returns `201 { id }`, then extracts in an in-process background task: the Job Profile chain first, then the CV chain. The client polls `GET /runs/:id`.
- On success the Run stores the validated `cv` and `job_profile` (with IDs) and stays at `extracting`, with `parse` and `extract` done and `coverage` pending. `job` in the view comes from the Job Profile's title and company.
- On failure the Run is `failed` with `EXTRACTION_FAILED` (two invalid attempts), `NO_REQUIREMENTS` (the Job Description has none) or `INTERNAL` (timeout, model unreachable, prompt too large for the context window). The slice 1 code for an unreadable file is now `UNREADABLE_FILE`.
- PDFs are read in visual order: lines are grouped by position and two-column pages are read column by column (`parsing/pdfLayout.ts`).
- Extraction checks: Zod, then dates (ADR 0004), then the verbatim check on protected fields (company, title, institution, degree, field, certification name, the year of every date, and the month when one is extracted). One retry with the issues fed back.
- Tracing: Phoenix gets one root trace per extraction, `extract_job_profile` and `extract_cv`, with the LangChain model call and parser nested under each and the `extraction.*` attributes on the root.
- Docs: `decisions.md` (including "After implementation"), `plan.md`, `tickets/` 01 to 09, `review.md`, `retrospective.md`.
- Tests: 148 backend, 27 shared; `pnpm typecheck` passes. No test calls a model.

## Running it locally
- `docker compose up -d postgres phoenix` (Postgres on host port 15432, Phoenix on 6006). Copy `.env.example` to `backend/.env`.
- Ollama with `qwen3:14b` and all three settings: `OLLAMA_CONTEXT_LENGTH=16384 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve`. Without the first, Ollama silently uses a 4096-token window. The macOS Ollama app ignores shell variables, so set them with `launchctl setenv` (they last until reboot) or run `ollama serve` yourself. Check with `ollama ps`: `CONTEXT 16384`. The model uses about 10 GB, so stop Ollama when you are done.
- `pnpm --filter backend dev` starts the server. `pnpm --filter backend extract <cv> <job-description> [--check]` runs both chains without HTTP or the database; `--check` compares with the answer key next to the CV in `local-cvs/`.
- Postman: "Upload PDF (happy path)" creates a Run; "Get run" re-reads the saved `runId`.
- Phoenix span tree without content: `curl -s "http://localhost:6006/v1/projects/resume-ai/spans?limit=60"`, then rebuild the tree from `context.span_id` and `parent_id`.

## Manual checks done
- **Dev script on the owner's CV:** reading order correct; `--check` caught an invented month and a combined heading, both fixed (`decisions.md`, "Validation and retries").
- **API end to end:** `POST /runs`, extraction `done`, counts match the answer key (1 experience, 2 education, 0 certifications, 0 additional sections). The Job Profile had 8 Requirements, against 11 in an earlier dev-script run (a different paste or model variance; not pursued).
- **Phoenix:** two named roots, correctly nested, with attributes (see `decisions.md`).

## Timings and the timeout
| Call | Measured on local `qwen3:14b` |
|---|---|
| Job Profile | 63 to 75 s |
| CV | 79 to 97 s |

`LLM_TIMEOUT_MS` stays at 180000, about 2x headroom. Revisit on a hosted model.

## Open items
Extraction and checks:
- **Context window mismatch is undetectable.** The guard trusts `LLM_CONTEXT_TOKENS`; if Ollama runs with a smaller window, prompts are silently truncated.
- **The output reserve may be too small (review 11).** The guard reserves a fixed 4096 tokens, but CV output is about as large as the input. Measure on a 3- to 5-page CV with the dev script; if needed, size it from the input for `extract_cv`.
- **Additional-section items are free text**, so dates and titles in them are not protected, and tailoring could reword them. Slice 4 needs a rule.
- **Bare years:** a duration Requirement ("3+ years") can be ambiguous when the CV gives only years. Coverage should leave it unmet so the Question asks for the duration (slices 3 and 4).
- **Month names are English only** in the verbatim check.
- **Issue paths are written two ways (review 13):** `experience.1.company` from `LlmSchemaError`, `experience[1].company` from the verbatim and ID checks. Share one formatter.
- **Quality judgement is deferred** until a hosted model; don't tune prompts per CV on the local one.

Runs and storage:
- **No limit on concurrent extraction across Runs (review 10).** Each upload starts its own calls; queue time in Ollama counts toward the timeout, so a few uploads in a row can end in `INTERNAL`. Add a concurrency-1 queue, or a limit in slice 4's graph runner.
- **A failed Run shows `extract: done`**, because step states have no `failed` (`services/runs.ts`, `toRunView`).
- **A stored error with a null message reads as `""`** (`stores/runs.ts`).
- **`RunStatusSchema` lives in `stores/runs.ts`**, derived from `RunViewSchema`, rather than in `shared/`.
- **A restart mid-extraction leaves the Run at `extracting`** (accepted until slice 4's checkpointer).

Tracing and logs:
- **A Run's traces are not linked (review 12).** See the slice 3 tracing proposal below.
- **Failure logs carry no content**, only the code, error name and issue count. Debugging a failed Run needs the dev script or Phoenix with `TRACE_CONTENT=true`.

Tests and parsing:
- **The 1 ms parse-timeout test is timing-dependent** (`test/parsing/parseCv.test.ts`). One unexplained red run out of 12 was seen near the end of the slice and never reproduced; it was most likely two test runs overlapping on the shared test database. If it recurs, suspect this test, the 20 ms LLM timeout test or the tracing test's 20 ms delay.
- **Short two-column pages:** column detection needs at least 4 lines on each side of the gutter (`MIN_COLUMN_LINES` in `pdfLayout.ts`), so a short two-column page falls back to row order.

From slice 1, still open: `TOO_MANY_PAGES` for long DOCX, the expiry sweep (slice 5), a killable parse worker and a DOCX size cap (before public traffic), the fixture script's location, the CV template, and environments and deployment.

## Before the PR
- `git log -p master..HEAD` and the working tree must have 0 matches for the names in `local-cvs/` (type the names only in the shell). The local tag `backup/pre-scrub` holds the old, unscrubbed history: never push it, and delete it after the merge with `git tag -d backup/pre-scrub`.

## Next: slice 3, scoring
Per `docs/README.md`: the **Coverage chain** (a verdict per Requirement: met, partially met or unmet, with cited Evidence) and the **Match Score** (deterministic; weights in `backend/src/scoring/weights.ts`). Start with a grilling session.

Inputs for it:
- Coverage reads `cv` and `job_profile` from the Run (ADR 0003 slice 2 extension).
- Reuse the `LlmClient` seam, `FakeLlmClient` and `withSpan`.
- Prompts show IDs (`exp1.b1`, `req1`) so Evidence can cite them.
- Where the Run's status goes after Coverage (today it parks at `extracting` with `extract: done`).
- The bare-year duration question above.
- **Tracing structure** (agreed with the owner in discussion, still to be recorded as a decision, possibly an ADR):
  - One trace per uninterrupted stretch of work. A trace ends wherever the flow waits for a human (Questions, review), because a root span is exported only when it ends.
  - The first stretch is a `pipeline` root: parse, extract, Coverage, Questions.
  - Every root span carries `session.id` set to the Run id (an OpenInference convention), so Phoenix's Sessions tab lists a Run's traces in order. Later requests (`/runs/:id/answers`) know the Run id from the URL.
  - Implementation: `withSpan` takes optional attributes or a session id, and the service wraps each stretch.
