# Handoff: slice 4a done, next is slice 5

## Where things stand
- `POST /runs` is unchanged: it parses the CV, creates the Run, returns `201 { id }` and starts the pipeline in an in-process background task. The client polls `GET /runs/:id`.
- The pipeline is now a **LangGraph graph** (`graph/runGraph.ts`), run by `graph/runner.ts`:

  ```
  extract → assess_coverage → begin_round → tailor → validate → rejudge → route ─┐
                  │                 ▲                                            │
                  │                 └────────────── next round ──────────────────┤
                  └───────── nothing to tailor ──────────→ review (interrupt) ←──┘
  ```

  - `extract`: the Job Profile and CV chains. `assess_coverage`: Coverage and the score before.
  - `tailor` proposes Changes for the Requirements not met; `validate` runs the stage-1 code checks and the blind claim check; `rejudge` re-runs Coverage only for the Requirements a valid Change addressed.
  - `route` is the exit router (`scoring/`): `target_reached`, `ceiling` (0 valid Changes two rounds in a row), `plateau`, `max_iterations` (3) or `error`. A round that lowers the score is undone.
  - The graph stops before `review` (`interruptBefore`). Slice 6 resumes it.
- **Statuses.** The runner writes `status` when a node starts (`NODE_STATUS`, pinned by a test).

  | Status | Nodes | View shows |
  |---|---|---|
  | `extracting` | `extract`, `assess_coverage` | steps |
  | `tailoring` | `begin_round` to `rejudge` | iterations used / max 3, score before and latest |
  | `awaiting_review` | `review` | before and after score, before and after verdict per Requirement, Tailored CV, Changes, exit reason, `userEvidence` empty, `confirmedGap` false |
  | `failed` | any, before the first score | error code and message, the failed step |

  The `questions` step shows `done` in 4a. A failure inside the loop is not a Run failure: the round is undone and the Run stops at `awaiting_review` with exit reason `error`.
- **Draft CV.** Never stored: the original CV plus the valid Changes, through the pure `applyChanges` (`tailoring/`). One Change per Item; `before` is always the original text.
- **Storage.** Everything a Run works on lives in the checkpoint. `app.runs` keeps only `id` (= `thread_id`), `status`, `error_code`, `error_message`, `created_at`, `expires_at` and `export_path`. The five transitional columns are dropped. The Postgres checkpointer uses its own `checkpoints` schema (ADR 0005) and is set up at startup.
- **Models.** `LLM_MODEL` (gpt-4.1-mini) extracts the CV. `LLM_JUDGE_MODEL` (gpt-4.1) extracts the Job Profile and runs Coverage, the tailor and the claim check; it falls back to `LLM_MODEL` when unset.
- **Match Score.** Responsibilities weigh half (kind factor, ADR 0004 amendment).
- **Tracing.** One `pipeline` root span per Run, with `session.id` = the Run id and `score.before`, `score.after`, `rounds` and `exit_reason`. Named children: `extract_*`, `assess_coverage`, then per round `tailor`, `validate`, `claim_check`, `assess_coverage`, each with a `round` attribute. `TRACE_CONTENT=false` keeps CV and Job Description text off LangGraph's spans too (pinned by a test in #19).
- **Docs.** `decisions.md` (with "After implementation"), `review.md` with the owner's decision. Spec #5 and tickets #6 to #17 and #19 are on GitHub.
- **Tests:** 383 backend, 31 shared; `pnpm typecheck` passes. No test calls a model.

## Running it locally
- `docker compose up -d postgres phoenix` (Postgres on host port 15432, Phoenix on 6006).
- `pnpm --filter backend exec prisma migrate deploy`. **The migration deletes old dev Runs**; they are not migrated.
- `backend/.env` needs **`LLM_JUDGE_MODEL=gpt-4.1`**. The old `LLM_COVERAGE_MODEL` is no longer read, so rename that line. The rest is as in slice 3 (`OPENAI_API_KEY`, `LLM_MODEL=gpt-4.1-mini`, `LLM_CONTEXT_TOKENS=128000`, `LLM_TIMEOUT_MS=60000`).
- `pnpm --filter backend dev` starts the server.
- Dev script: `pnpm --filter backend extract <cv> <jd> [--coverage] [--tailor] [--check]`. `--tailor` runs the whole loop in memory and prints each round (Changes, rejections with reasons, scores) and each Requirement's kind. The run is one `pipeline` trace in Phoenix.
- Postman: "Upload PDF (happy path)" creates a Run, then re-send "Get run (awaiting_review)" by hand until it is `awaiting_review` or `failed` (it does not poll).
- Tests: `pnpm --filter backend test`. To run test suites in parallel (for example in two worktrees), give each its own database with `TEST_DATABASE_URL`.

## Manual checks done
Details in `decisions.md`, "After implementation".
- **First manual run:** the tailor appended qualities the CV never states; the claim check rejected all of them. The tailor prompt was tightened (#16).
- **Second run:** the score before tailoring moved from 69 to 57 on identical input. The Job Profile moved to gpt-4.1 and the loop got a second chance before `ceiling` (#17).
- **Score spread:** across runs, 69, 57, 54, 65 on one job and 49, 43 on another. Requirement counts are steadier now, so the spread seems to come from Coverage verdicts. Filed as #18.
- **Tailoring gains:** across 6 dev runs and 1 Postman run, the claim check accepted no Change. Every rejection was a real addition (for example a technology the CV lists only as a skill). 4a works as designed; gains need facts from the owner.
- **Postman end to end:** `awaiting_review`, 48 → 48, 2 rounds, no Changes, exit `ceiling`, 22.2 s. Phoenix showed one `pipeline` trace with the expected attributes and children.

## Cost
Real token counts from the Postman Run:

| Model | Used for | Tokens in / out | Cost |
|---|---|---|---|
| gpt-4.1 | Job Profile, Coverage, tailor, claim check | 9,916 / 2,857 | about $0.043 |
| gpt-4.1-mini | CV | 2,151 / 875 | about $0.002 |
| **Total per Run** | | | **about $0.045** |

Three times slice 3, under the planned worst case of $0.08. About 100 Runs on the owner's $4.79 balance. Phoenix still shows "Total Cost $0"; work it out from the token counts.

## Open items
Scores and tailoring:
- **#18: the Match Score varies by up to 15 points on identical input.** Measure first, then a grill.
- **Tailoring gains need facts from the owner.** With support only from the CV, the claim check rejects nearly everything. Slice 5's User Evidence is the way in.

Review items kept as is (owner's decision, `review.md`):
- S2: named spans sit beside LangGraph's node spans, not under them.
- S4, S5, S8, S12: refactors with no behaviour change (item-ID helpers, retry-once copied three times, round data clump, `toRunView` guard). Candidates for slice 5.
- P2: the round-failure log has no `code` field.
- P3: an incomplete `awaiting_review` state falls through to the extracting view.
- P5: Postman's "Get run (awaiting_review)" does not poll.
- P6: `runs` keeps `export_path` (ADR 0003 lists it as Run metadata).

Carried from slices 2 and 3:
- **Context window mismatch is undetectable:** the guard trusts `LLM_CONTEXT_TOKENS`.
- **The output reserve is fixed at 4096 tokens.**
- **Month names are English only** in the verbatim check.
- **Issue paths are written two ways** (`experience.1.company` and `experience[1].company`).
- **`RunStatusSchema` lives in `stores/runs.ts`**, not in `shared/`.
- **gpt-5-mini and gpt-6-luna return `400 invalid model ID`** on Chat Completions. Not pursued.

## Before the PR
- `git log -p master..HEAD` and the working tree must have 0 matches for the names in `local-cvs/` (type the names only in the shell).

## Next: slice 5, `05-questions-and-live-updates`
Per `docs/README.md`. Start with a grilling session.

Scope:
- **Questions and Answers:** an interrupt that pauses the graph and resumes it with `Command({ resume })` once the owner answers.
- **User Evidence:** facts the owner supplies, which the claim check trusts like CV Evidence.
- **Confirmed Gaps:** Requirements the owner confirms they don't meet.
- **SSE** live updates instead of polling.
- **Crash resume:** a Run cut off by a restart resumes from its checkpoint or shows `interrupted`.

Inputs for it:
- **Question candidates:** every rejected Change and every "only in the skills list" `partially_met` verdict points at a fact only the owner can confirm ("Was the Design System built in React?", "Did you optimize SQL queries?").
- **Tracing:** later stretches of work (after Answers, after review) get their own root span with the same `session.id`, through `withSessionSpan`.
- #18 (score spread) may need settling first, so that gains from Answers can be told apart from noise.

After that:
- Slice 6, `06-review-export-cleanup`: per-Change review (resumes the graph at `review`), DOCX/PDF export, TTL sweep, `DELETE /runs/:id`.
- Slice 7, `07-frontend`: starts with a **Claude Design pass** before any frontend code is planned. The owner asked for this explicitly and called it very important.
