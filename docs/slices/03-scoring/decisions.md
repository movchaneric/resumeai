# Slice 3 decisions: Coverage and the Match Score

Settled in a grilling session (2026-10-23 and 24) before implementation. Scope comes from the slice 2 handoff. Terms follow `CONTEXT.md`, which gained **Claim** and a sharper **Requirement Coverage** in this session.

## Pipeline
- Coverage runs right after extraction, in the same background task: Job Profile, CV, then Coverage. No new trigger.
- While Coverage runs, the Run shows `extracting` with `parse` and `extract` done and `coverage` running. When it is done, the Run moves to a new transitional status, `scored` (see Run view).
- No queue. With a hosted model, Runs run side by side. With the local model, a second Run started while one is running may time out in Ollama's queue. This is an open item, not code. Slice 4's graph runner owns any limit.

## Tracing
- **One trace per uninterrupted stretch of work.** A stretch ends wherever the flow waits for a human (Questions, review), because a root span is exported only when it ends.
- The first stretch is a `pipeline` root span opened in the background task. It covers extraction and Coverage; slice 4 adds Questions to it. Parse is not in the trace: it takes milliseconds, calls no model, and a parse failure creates no Run, so there would be no Run id.
- **Every root span carries `session.id` = the Run id** (OpenInference's `SemanticConventions.SESSION_ID`), so Phoenix's Sessions tab lists a Run's traces in order. Later stretches (slice 4: after Answers, after review) get their own root with the same `session.id`; the Run id comes from the URL.
- `extract_job_profile`, `extract_cv` and the new `assess_coverage` nest under `pipeline` instead of being roots.
- Spans carry counts and numbers only, never content: `coverage.retries`, `coverage.downgrades`, `coverage.met`, `coverage.partially_met`, `coverage.unmet` on `assess_coverage`; the unrounded `score` on `pipeline`. Content stays controlled by `TRACE_CONTENT` alone (ADR 0006).
- `withSpan` takes optional attributes. The error attribute is renamed from `extraction.failure_reason` to `failure_reason`, because it now sits on Coverage and pipeline spans too.
- Not an ADR: it is a real trade-off but cheap to reverse (a few lines in `withSpan` and the service, and traces are disposable).

## Coverage chain
- **One call judges a list of Requirements.** Slice 3 passes all of them. Slice 4's re-judging (ADR 0003) passes only the Requirements an applied Change addressed, through the same function. Rejected: one call per Requirement (4 to 8 minutes on the local model, 8 to 11 calls per Run). If verdicts late in a long list prove worse, batching can go behind the same function later.
- **Prompt input is rendered text with IDs**, not JSON: each CV line starts with its Item ID (`[exp1.b2] Built the billing API…`), and each Requirement shows its ID, importance and text (`[req1] (must-have) TypeScript, 3+ years`). Roughly half the tokens of JSON, and easier for small models to cite. The renderer is a pure, tested function in `prompts/`, reused by slice 4's tailoring.
- **Output order per Requirement: reason, then Evidence IDs, then verdict.** A model writes top to bottom, so the verdict follows from the reasoning instead of being justified afterwards. This matters with thinking off. The reason is 1 to 2 sentences. Our code maps the answer into the shared `CoverageSchema`.

## Coverage rules
**Retry (structural problems).** Each of these is an issue. Any issue triggers one retry with the issues fed back; a second failure fails the Run with `COVERAGE_FAILED`:
- a Requirement in the list has no verdict, or has more than one
- a verdict names a Requirement that is not in the list
- an Evidence ID does not exist in the CV
- `met` or `partially_met` cites no Evidence

**Downgrade (the Claim rule), applied in code after the checks pass.** A Claim alone makes a Requirement partially met at most:

| Evidence | Normal Requirement | `kind: language` |
|---|---|---|
| `summary`, `skillN` (a Claim) | at most partially met | can be met |
| `secN.iM` (additional section) | counts as shown in use | can be met |
| `exp`, `proj`, `edu`, `cert` Items | counts as shown in use | can be met |

- When a `met` verdict cites only Claims, our code changes it to `partially_met` and replaces the reason with a fixed sentence: "Listed in the skills or summary, but no experience, project or education Item shows it." The model's reason would contradict the new verdict.
- This is a deliberate exception to "our code checks the model, never rewrites it": a downgrade costs nothing, while a retry costs a full call. The count is a span attribute, so we see how often the model breaks the rule.
- The prompt states the same rule, so downgrades should be rare.
- The rule relies on slice 2's IDs: the prefix comes from the section type, never from the candidate's heading.
- Additional sections count as shown in use because they hold real activity (service, volunteering). A section that is really a second skills list is accepted for now.
- Language Requirements are exempt because a listed language is how a CV normally proves one.

**Unmet cites nothing (added after the Postman run).** Two `unmet` verdicts still cited Evidence (the job, a skills entry). Our code clears the Evidence list on every `unmet` verdict and leaves the verdict, the reason and the score unchanged. No retry, for the same reason as the downgrade: it's free, while a retry costs a full call. Unknown Evidence IDs on an `unmet` are still a retry issue (ticket 09).

**Durations.** A Requirement such as "3+ years" is met only when the dates of the cited Items prove the duration. When the dates are years only, or don't add up, the verdict is partially met with that reason. This lives in the prompt only, with no code check. It settles slice 2's bare-year item: partially met gives no Question (Questions are for unmet must-haves), which is the intended outcome.

## Match Score
- `score = 100 × Σ(weight × credit) / Σ(weight)`, with the ADR 0004 values in `backend/src/scoring/weights.ts`: must-have 3, nice-to-have 1; met 1, partially met 0.5, unmet 0.
- Shown as a whole number (`Math.round`): the inputs are three-step model verdicts, so decimals would suggest false precision. Slice 4's exit router compares unrounded values.
- No zero-weight case: a Job Profile always has at least one Requirement (`NO_REQUIREMENTS` fails the Run first).

## Storage (extends the ADR 0003 slice 2 extension)
- `app.runs` gains `coverage` (JSONB, an array of `Coverage`, Zod-validated on read), stored with the downgrades applied, so what is stored is what is shown.
- The score is **not** stored. It is computed from `coverage` and the Requirements' importance when the Run is read, so it can never disagree with the verdicts. A weight change also changes old Runs' scores; dev Runs are disposable.
- Slice 4 moves `coverage` into the graph state with the other transitional columns.

## Run view and errors
- New status `scored` in `RunViewSchema`, transitional until slice 4 replaces it with `awaiting_answers` or `tailoring`. It carries `job`, `steps` (parse, extract, coverage done), `score` (a whole number) and `requirements`: for each Requirement its id, text, importance, verdict, Evidence IDs and reason. This makes Coverage checkable in Postman, the way slice 2's manual run worked.
- `StepStateSchema` gains `failed`. A failed Run shows the step that broke as `failed` (`extract` or `coverage`) instead of `done`. This closes slice 2's "a failed Run shows `extract: done`" item.
- New error code `COVERAGE_FAILED` ("We couldn't assess your CV against this job. Try again."). The Run becomes `failed`, and `cv` and `job_profile` stay stored. A timeout, an unreachable model or a prompt too large for the window stays `INTERNAL`.

## Model: OpenAI, measured first
- Development moves from local Qwen to OpenAI. The code already uses `ChatOpenAI` behind `LlmClient`, so this is mostly config: no `OPENAI_BASE_URL`, `LLM_MODEL`, the key, and a larger `LLM_CONTEXT_TOKENS`.
- **One code change:** `reasoning_effort: "none"` is hard-coded for Qwen, and OpenAI's non-reasoning models (gpt-4o-mini, gpt-4.1-*) reject the parameter. It becomes an optional setting, `LLM_REASONING_EFFORT`, sent only when set. `.env.example` sets it to `none` in the Ollama block.
- **The model is chosen by measuring:** run the dev script's `--check` with gpt-4o-mini, gpt-4.1-mini and gpt-6-luna on the owner's CV (about 2 cents in total), and keep the cheapest that passes the answer key. gpt-4.1-mini is the safe fallback.
- Prices from OpenAI's pricing page (2026-10-24), per 1M input/output tokens: gpt-4.1-nano $0.10/$0.40, gpt-6-luna $0.10/$0.50, gpt-4o-mini $0.15/$0.60, gpt-4.1-mini $0.40/$1.60.
- Estimated cost per Run: about 6k input and 3k output tokens, under $0.01 on any of these. Recheck it against Phoenix's token counts after the first Runs. Slice 4's tailoring loop will multiply it.
- **Measured (2026-10-24), owner's CV, `--check` against the answer key:**

  | Model | `--check` | Job Profile + CV time |
  |---|---|---|
  | gpt-4o-mini | 2 mismatches in each of 2 runs, different each time; one run dropped the current job's start date and lost an education entry | about 12 s |
  | gpt-4.1-mini | 1 mismatch in both runs: an education degree shortened to a substring that still appears in the CV (no fact lost) | about 9 s |
  | gpt-6-luna | `400 invalid model ID` on Chat Completions, although the key lists the model (likely Responses-API only); not pursued | |

  **Chosen: gpt-4.1-mini**, about $0.007 per Run and about 18x faster than local Qwen. gpt-4o-mini is rejected for losing facts.
- `LLM_TIMEOUT_MS` drops to about 60 s for hosted models; Ollama keeps 180 s in its `.env.example` block.
- Rejected for now: the Gemini free tier (Google's pricing page says free-tier content may be used to improve their products, which rules it out for a CV), and Groq (strict JSON-schema output not confirmed).
- Privacy: the owner's CV now goes to OpenAI's API. This was the owner's informed choice; Ollama stays available through config.

## Coverage model (after the first manual runs, 2026-10-24)
- The first Coverage run on the owner's CV with gpt-4.1-mini scored **98**: 28 of 29 Requirements were met or partially met. The reasons inferred proof instead of citing it: one invented "based on feedback and data", others reasoned "…, indicating ability to iterate quickly". The Claim rule never fired, because the model cited the skills list plus an unrelated bullet.
- Ticket 07 made the prompt stricter: `met` needs an Item that states the Requirement; inference gives at most `partially_met`; the reason may not add details; soft skills need a described behaviour; two made-up examples. gpt-4.1-mini then scored **94** and still wrote "indicating…" next to `met`. **Prompt rules alone did not change gpt-4.1-mini's judgement.**
- With the same prompt, gpt-4.1 scored **65** (15 met, 14 partially met, 4 unmet). It wrote no inference reasons and disagreed with the hand-written verdict key on 6 of 29 Requirements.
- **Decision: two models for two jobs.** Extraction stays on gpt-4.1-mini: it copies, and our verbatim check verifies the copy. Coverage moves to gpt-4.1: it judges, and code can check only its structure. Setting: `LLM_COVERAGE_MODEL`, defaulting to `LLM_MODEL` (ticket 08). About $0.03 per Run (gpt-4.1 is $2/$8 per 1M tokens), roughly 160 Runs on the current balance.
- Rejected: everything on gpt-4.1 (about $0.05 per Run, paying more for extraction, which already passes); a code downgrade on words like "indicating" (brittle, and the model can avoid the words while staying lenient).
- Open: the Job Profile's Requirement count varied (29, 19, 33) across three runs, so part of the score's movement is the list itself. If it stays erratic, move only the Job Profile extraction to gpt-4.1.
- Open: gpt-5-mini and gpt-6-luna fail with `400 invalid model ID` although the key lists them. Our Chat Completions call probably doesn't suit OpenAI's newer models. Not pursued.

## Quality check
- The dev script gains `--coverage`: after extraction it runs Coverage and prints each verdict with its Evidence and reason, then the score.
- With `--check`, it also compares with a small, hand-written verdict key in `local-cvs/` (not in git), for one real job description.
- The key matches Requirements by their text, not their ID, because the Job Profile's Requirement list varies between runs. It reports Requirements it cannot find.
- Mismatches are warnings, not failures: two reasonable judges can disagree on partially met versus met.
- A full eval set waits for a hosted model and more CVs ("we're overanalyzing these resumes").

## Structure
```
backend/src/
  scoring/      assessCoverage.ts (chain, prompt, checks, one retry), coverageRules.ts (pure: issues + downgrade),
                matchScore.ts (pure), weights.ts
  prompts/      renderCv.ts (pure: Cv → text with IDs; Requirements → text with IDs)
```
`scoring/` follows `extraction/`'s rules: it imports `LlmClient` and `withSpan`, never LangChain. `prompts/` imports only shared types. Tests mirror this under `backend/test/scoring/` and `backend/test/prompts/`. `CLAUDE.md` gains both folders.

## Carried forward
- Slice 6 (frontend) starts with a Claude Design pass before any frontend code is planned. The owner asked for this explicitly.
