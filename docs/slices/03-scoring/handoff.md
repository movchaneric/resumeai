# Handoff: slice 3 done, next is slice 4

## Where things stand
- `POST /runs` parses the CV, stores the Run, returns `201 { id }`, then runs the pipeline in an in-process background task: the Job Profile chain, the CV chain, then the **Coverage chain**. The client polls `GET /runs/:id`.
- While Coverage runs, the Run shows `extracting` with `parse` and `extract` done and `coverage` running. On success it moves to the transitional status `scored`, with `job`, `steps`, `score` (a whole number) and `requirements` (id, text, importance, verdict, Evidence IDs and reason for each).
- Coverage is one call for the whole Requirement list. The prompt is rendered text with IDs (`prompts/renderCv.ts`); the model writes reason, then Evidence, then verdict. Structural problems (missing or duplicate verdicts, unknown Requirements, unknown Evidence IDs, `met` or `partially_met` with no Evidence) get one retry, then `COVERAGE_FAILED`. Section IDs (`sec1`) are not accepted as Evidence.
- Code rules after the checks pass: the **Claim rule** downgrades a `met` that cites only the summary or skills to `partially_met` (languages exempt), and every `unmet` verdict has its Evidence cleared. Durations ("3+ years") are judged in the prompt only.
- **Match Score** is computed when the Run is read, from the stored `coverage` and the Requirements' importance (`scoring/weights.ts`: must-have 3, nice-to-have 1; met 1, partially met 0.5, unmet 0). It is not stored.
- A failed Run now shows the step that broke as `failed` (`extract` or `coverage`), which closes slice 2's "a failed Run shows `extract: done`".
- **Models:** OpenAI by default. Extraction runs on gpt-4.1-mini (`LLM_MODEL`); Coverage runs on gpt-4.1 (`LLM_COVERAGE_MODEL`, falling back to `LLM_MODEL` when unset). `LLM_REASONING_EFFORT` is optional and sent only when set. Ollama stays available through config.
- **Tracing:** one `pipeline` root span per Run, with `session.id` = the Run id and the unrounded `score`; `extract_job_profile`, `extract_cv` and `assess_coverage` nest under it, the last with the `coverage.*` counts. Services open it with `withSessionSpan` (`utils/spans.ts`) and import no OpenTelemetry.
- Storage: `app.runs` gains `coverage` (JSONB), recorded as the slice 3 extension in ADR 0003.
- Docs: `decisions.md` (including "Coverage model" and the model measurements), `plan.md`, `tickets/` 01 to 10, `review.md` with the owner's decision, `retrospective.md`.
- Tests: 220 backend, 30 shared; `pnpm typecheck` passes. No test calls a model.

## Running it locally
- `docker compose up -d postgres phoenix` (Postgres on host port 15432, Phoenix on 6006). Copy `.env.example` to `backend/.env`.
- **OpenAI (default):** in `backend/.env`, set `OPENAI_API_KEY` and keep `LLM_MODEL=gpt-4.1-mini`, `LLM_COVERAGE_MODEL=gpt-4.1`, `LLM_CONTEXT_TOKENS=128000`, `LLM_TIMEOUT_MS=60000`. The key goes only in `backend/.env`, never in `.env.example`.
- **Ollama instead:** comment out the OpenAI block and uncomment the Ollama block in `.env.example` (leave `LLM_COVERAGE_MODEL` unset). Start Ollama with `OLLAMA_CONTEXT_LENGTH=16384 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve` and check `ollama ps` (see the slice 2 handoff). Upload one CV at a time.
- `pnpm --filter backend dev` starts the server.
- Dev script: `pnpm --filter backend extract <cv> <jd> [--coverage] [--check]` runs the chains without HTTP or the database. `--coverage` adds Coverage and prints each verdict with its Evidence and reason, then the score. `--check` compares with the CV answer key `<cv>.expected.json` and, with `--coverage`, the verdict key `<jd>.coverage.json`, both next to the files in `local-cvs/`. Mismatches are warnings, not failures.
- Postman: "Upload PDF (happy path)" creates a Run, then "Get run (scored)" polls until `scored` or `failed` and checks the score and Requirements.
- Phoenix: one `pipeline` trace per Run. The Sessions tab groups a Run's traces by `session.id`.

## Manual checks done
- **Model comparison** (dev script `--check` against the answer key, owner's CV, two runs each):
  - gpt-4o-mini lost facts (dropped the current job's start date, lost an education entry) and its mismatches changed between runs. Rejected.
  - gpt-4.1-mini had 1 stable, harmless mismatch: an education degree shortened to a substring that is still in the CV. Chosen for extraction.
  - gpt-6-luna and gpt-5-mini fail with `400 invalid model ID` on our Chat Completions call, although the key lists them (open item).
- **Coverage on the owner's CV:** the first run with gpt-4.1-mini scored 98, with reasons that inferred proof ("indicating…", and one invented "based on feedback and data"). Ticket 07's stricter prompt gave 94, still inferring. gpt-4.1 gave 65, then 68 and 70 with the two-model setup, with 5 to 6 disagreements against a 29-entry verdict key. See `decisions.md`, "Coverage model".
  - **The verdict key was written by Opus, not the owner**, from the extracted CV and Job Profile. So `--check` measured agreement between two judges, not ground truth. The owner should review the key.
- **API end to end (Postman, a different job description: a senior full-stack role on Python, .NET, Azure and M365):** status `scored`, score 41 (2 met, 8 partially met, 6 unmet of 16). The duration rule, the Claim rule and the language exemption were all visible in the reasons. Two `unmet` verdicts cited Evidence, which led to ticket 09. Coverage was possibly too strict on one integration Requirement (watch, not changed).
- **Phoenix:** one `pipeline` root (16.2 s) with `session.id` = the Run id and the unrounded `score`; children `extract_job_profile` 6.4 s, `extract_cv` 4.7 s and `assess_coverage` 5.1 s with the `coverage.*` counts.

## Cost
Real token counts from that Run in Phoenix:

| Model | Used for | Tokens in / out | Cost |
|---|---|---|---|
| gpt-4.1-mini | Job Profile + CV | 2,871 / 1,576 | about $0.004 |
| gpt-4.1 | Coverage | 1,839 / 944 | about $0.011 |
| **Total per Run** | | | **about $0.015** |

About 300 Runs on the owner's current $4.79 balance (the earlier estimate in `decisions.md` was about $0.03). Phoenix shows "Total Cost $0" because it has no prices for these model names; work the cost out from the token counts. The whole pipeline takes about 16 to 20 s, against about 160 s on local Qwen. Slice 4's tailoring loop will multiply the cost.

## Open items
Models and Coverage:
- **gpt-5-mini and gpt-6-luna return `400 invalid model ID`** on Chat Completions, although the key lists them. Probably Responses-API only. Not pursued.
- **The Job Profile's Requirement count varies** between runs (29, 19, 33), so part of the score's movement is the list itself. If it stays erratic, move only the Job Profile extraction to gpt-4.1.
- **Responsibilities are about half the Requirements** and a CV rarely proves them. Open question for slice 4: weight them lower?
- **Coverage may be too strict** on some Requirements (one integration Requirement in the Postman run). Watch, not changed.
- **The verdict key needs the owner's review** (see Manual checks).

Tracing:
- **Dev-script runs are ungrouped in Phoenix:** each chain is its own root, because the script has no `pipeline` wrapper. Small follow-up.

Carried from slice 2:
- **No queue for local Ollama:** with Ollama, run one Run at a time; a second concurrent Run may time out in Ollama's queue. Slice 4's graph runner owns any limit.
- **Context window mismatch is undetectable:** the guard trusts `LLM_CONTEXT_TOKENS`.
- **The output reserve is fixed at 4096 tokens.**
- **Additional-section items are free text**, so their dates and titles are not protected. Slice 4 needs a rule before tailoring.
- **Month names are English only** in the verbatim check.
- **Issue paths are written two ways** (`experience.1.company` and `experience[1].company`).
- **`RunStatusSchema` lives in `stores/runs.ts`**, not in `shared/`.
- Slice 1 leftovers and the rest of slice 2's list: see the slice 2 handoff.

Review items kept as is (owner's decision, `review.md`): P3 (a failed Run shows `job`), P4 (extra CV fields in the prompt), S6 to S10 (readability preferences).

## Before the PR
- `git log -p master..HEAD` and the working tree must have 0 matches for the names in `local-cvs/` (type the names only in the shell).

## Next: slice 4, the graph
Per `docs/README.md`: LangGraph with a checkpointer, the **Questions** interrupt for unmet must-haves, tailoring, validation, re-judging, the exit router, SSE and resume. Start with a grilling session.

Inputs for it:
- The transitional status `scored` is replaced by `awaiting_answers` or `tailoring`.
- The transitional columns (`cv_text`, `job_description_text`, `cv`, `job_profile`, `coverage`) move into graph state (ADR 0003).
- Re-judging calls `assessCoverage` with only the Requirements an applied Change addressed; it already takes a list.
- The exit router compares unrounded scores (`scoring/matchScore.ts`).
- Later stretches of work (after Answers, after review) get their own root span with the same `session.id`, through `withSessionSpan`.
- Open questions above that touch slice 4: responsibilities weighting, free-text additional sections, a concurrency limit.
- Slice 6 (frontend) starts with a Claude Design pass before any frontend code is planned (the owner's explicit request).
