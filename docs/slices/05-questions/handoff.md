# Handoff: slice 5a done, next is slice 5b

## Where things stand
- The graph now pauses for Questions after the first Coverage:

  ```
  extract → assess_coverage → select_questions → collect_answers (interrupt) → begin_round → tailor → … → review
  ```

  - `select_questions` (`tailoring/questions.ts`) picks at most 5 must-haves that are `unmet` or `partially_met`, heaviest first, and builds template Questions (`q1`…). With none, the Run goes straight on.
  - `collect_answers` calls `interrupt()`. The Run shows `awaiting_answers` with its Questions.
- **`POST /runs/:id/answers`** returns `202 { id }` and resumes the graph in the background. Errors in order: 404 (unknown or expired), 409 `RUN_NOT_AWAITING_ANSWERS`, 400 `INVALID_ANSWERS`. Malformed JSON is 400 `BAD_REQUEST`. `RunStore.claimStatus` moves the Run to `tailoring` in one conditional update, so a double submit gets 409. Body limit 64 kb.
- **Answers** become **User Evidence** (`ue1`…, for the Requirement asked about) or **Confirmed Gaps** (the user says they don't have it). Both live in the checkpoint state.
  - The tailor sees `[ueN] (for reqM) text` and targets Requirements with User Evidence first; Gaps are left out.
  - Stage 1 and the claim check accept the Answer text as Evidence.
  - Coverage never sees User Evidence: the score moves only through the tailored CV.
  - The exit router stops with `ceiling` when every must-have not met is a Gap, before round 1 or after a round.
  - The review view sets `confirmedGap` per Requirement.
- **Tracing.** The resume runs under a new `answers` root span with the same `session.id`, so Phoenix shows the Run as one session.
- **Docs.** `decisions.md` (with "After implementation"), `review.md` with the owner's decision, `retrospective.md`. Spec [#30](https://github.com/movchaneric/resumeai/issues/30), tickets #31 to #34.
- **Tests:** 538 backend, 32 shared; `pnpm typecheck` passes. No test calls a model.

## Running it locally
- As in slice 4a: `docker compose up -d postgres phoenix`, `pnpm --filter backend exec prisma migrate deploy`, `pnpm --filter backend dev`.
- **Model (changed this slice, `.env` only).** The OpenAI account ran out of credits, so the proof ran on **Gemini's free tier** through its OpenAI-compatible endpoint: `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `OPENAI_API_KEY` = an AI Studio key, `LLM_MODEL` and `LLM_JUDGE_MODEL` = `gemini-3.5-flash-lite`. The strict `json_schema` output works unchanged. The bigger flash models were 503 ("high demand") or timed out on the free tier. Scores on Gemini are not comparable with the gpt-4.1 numbers from #18.
- Postman: "Upload PDF", then "Get run" until `awaiting_answers`, then "Submit answers", then "Get run" until `awaiting_review`.

## Follow-ups
- **Log why an LLM call failed.** The pipeline logs only `LlmUnavailableError`; the message (which holds the HTTP status, for example `insufficient_quota` or 503) is dropped. Log the status and code without content.
- **Retry transient LLM errors.** The client uses `maxRetries: 0`, so one 503 or 429 fails the whole Run. One or two retries with backoff.
- **Question mix.** On job 1, 4 of 5 Questions were soft skills, because weight ties break by Requirement order. Revisit with a few more Runs.
- **Review to-dos:** S5, S6, S7, S10 in `review.md` (refactors); P9 (Answer length in the shared schema) in slice 7.
- Still open from earlier handoffs: close tickets #6 to #17 and #19; drop the `resume_ai_test_wt07` to `wt13` databases; delete old local branches `feat/shared-schemas` and `feat/slice-1/2/3-*`; test threads and 2 failed Runs left in the dev DB (expire with the TTL).
- #27 (claim-check eval): open, out of scope.

## Next
- **Slice 5b** (`05b-live-updates`): SSE progress and crash resume (`interrupted`).
- Then slice 6 (per-Change review, export, TTL sweep, delete), then slice 7 (frontend, starting with a Claude Design pass).
