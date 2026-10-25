# Slice 4 decisions: the tailoring loop

Settled in a grilling session (2026-10-24) before implementation. Scope comes from the slice 3 handoff. Terms follow `CONTEXT.md`, which was updated in the same session. All decisions are owner-approved.

Spec: [#5 Slice 4a: tailoring loop](https://github.com/movchaneric/resumeai/issues/5). Tickets are linked from it.

## Scope
- **Slice 4 is split in two.**

  | Slice | Folder | Holds |
  |---|---|---|
  | 4a | `04-tailoring-loop` | LangGraph + Postgres checkpointer; extract → coverage → tailor → validate → re-judge → exit router → `awaiting_review` interrupt; drop the transitional columns; polling stays |
  | 4b | `05-questions-and-live-updates` | Questions and Answers, User Evidence, Confirmed Gaps, SSE, crash resume (`interrupted`) |

- Why: 4a delivers a real Tailored CV with a before and after score, and ends at the real handoff point to review (slice 6). Questions only matter when unmet must-haves exist. Each half is about slice 3's size.
- Rejected: one slice (too big); a split by plumbing (it would leave a dead-end transitional status like `scored`).
- Cost accepted: in 4a, gains are limited to support already in the CV.

## Tailoring round
- **Targeted rounds.** The tailor gets the CV and the Requirements not met (partially met and unmet, must-haves first) and proposes Changes where the CV holds support. Met Requirements are context, so it doesn't break them. Each Change lists `requirementIds`; only those are re-judged (ADR 0003).
- Why: a whole rewrite that ignores verdicts polishes wording Coverage doesn't reward, and we couldn't tell good rounds from bad. Rejected for that reason.
- Expectation: 1 to 2 useful rounds, roughly +5 to +15 points in 4a.
- Example: Requirement "REST API design" is partially met; the bullet is "Built the backend for the orders service in Express". The tailor may target it (but see the claim check below).
- **One Change per Item.** A later round replaces the earlier Change on the same Item. `before` is always the original text. `requirementIds` merge across rounds. Reorders work the same way: one per list, latest wins. A later round may reword an added Item by replacing that `add` Change.
- Why: review is one card per Item (original → final), and the claim check always compares with the original Evidence, so rewordings can't drift.
- Validated Changes are applied to the working draft during the loop. Their status stays `proposed` until review (slice 6).

## Claim check and validation
**Strictness.** A Change's text may reword the Evidence and use the Job Description's wording, but states nothing the Evidence does not state: no new technologies, numbers, scope, roles or achievements.
- Example: "Built the backend for the orders service in Express" → "Designed and built the REST API for the orders service in Express" is **rejected**. "REST", "API" and "designed" are not stated.
- Why: the product never invents facts. Slice 3's inference reasons were what produced the fake 98. In 4b the owner can supply the missing fact as User Evidence.
- Rejected: "reasonable inference"; "plausible".

**Rejected Changes are dropped.** The next round's tailor is told which were rejected and why, so it doesn't repeat them.

**Stage 1: code checks.** Rejected in code with a reason, before the claim check:
- Structure: the target exists and is a text Item; Evidence IDs exist; a reorder is a permutation of the same Items; nothing touches dates, companies, titles or degrees.
- **Numbers are frozen**, on every `replace` and `add`: every number and date in `before` must appear in `after`, and `after` may contain no number or date that is not in `before` or the cited Evidence.
- This also protects the dates in additional-section Items, which closes slice 2's open item "additional-section items are free text".
- Accepted edge: "3 services" → "three services" is rejected.

**Stage 2: the claim check.** A separate, independent chain (not an agent, ADR 0001), in a fresh call.
- It sees **only** the `before` text, the `after` text and the cited Evidence Items' text. It does not see the rationale, the Requirement or the Job Description, so the goal can't sway it.
- Per Change it returns supported or not supported, with a reason.
- Same model as the tailor. A different judge model is a one-setting change later, if measurements show it is lenient.

## Exit router
Checked after every round. The constants live in `scoring/`, not in `.env`.

| Exit reason | When |
|---|---|
| `target_reached` | score ≥ 90 |
| `ceiling` | 0 valid Changes in a round (none proposed, or all rejected) |
| `plateau` | gain < 2 points (unrounded scores) |
| `max_iterations` | 3 rounds done |
| `error` | a chain failed inside the loop (see Failures) |

- A round that lowers the score is undone and the loop stops with `plateau`. The Tailored CV never scores below its previous round.
- If every Requirement is already met (or the score is 100) before round 1: skip tailoring, `target_reached`, zero rounds.
- Cost: about $0.02 per round on gpt-4.1; worst case about $0.08 per Run (about 60 Runs on the owner's $4.79 balance). Most Runs should stop after 1 to 2 rounds.

## Storage and status
- `runs` keeps `id` (= `thread_id`), `status`, `error_code`, `error_message`, `created_at`, `expires_at`. Everything else lives in the checkpoint (ADR 0003, slice 4 paragraph).
- A migration drops the five transitional columns (`cv_text`, `job_description_text`, `cv`, `job_profile`, `coverage`). Dev Runs are deleted, not migrated.
- The graph runner writes `status` at node boundaries. A test pins each node to its status.
- The checkpointer uses its own `checkpoints` schema (ADR 0005) and is set up at startup.

## Models
- The tailor and the claim check run on gpt-4.1, like Coverage.
- `LLM_COVERAGE_MODEL` is renamed **`LLM_JUDGE_MODEL`**: it covers judge-and-write work (Coverage, tailor, claim check) and falls back to `LLM_MODEL`. Extraction ("copy" work) stays on `LLM_MODEL` (gpt-4.1-mini).
- Rejected: one setting per chain (nobody asked to tune them); keeping the old name (misleading).
- Owner action when 4a lands: rename the line in `backend/.env` to `LLM_JUDGE_MODEL=gpt-4.1`.

## Match Score
- **Kind factor.** A kind factor multiplies the importance weight: `responsibility` ×0.5, every other kind ×1.

  | Requirement | Weight |
  |---|---|
  | must-have, responsibility | 1.5 |
  | must-have, other kinds | 3 |
  | nice-to-have, responsibility | 0.5 |
  | nice-to-have, other kinds | 1 |

- Why: about half the Requirements are responsibilities, and a CV rarely proves them. A factor of 0 was rejected: a responsibility is still part of the job, and the tailor needs a reason to target it. Recorded as an amendment in ADR 0004.
- Side effects: scores rise compared with slice 3 (not comparable; dev Runs are deleted anyway). The score now depends on extraction labelling `kind` correctly, so the dev script prints each Requirement's kind.
- The owner chose to change it now rather than measure first. Opus had recommended measuring first.

## Failures
- Extraction or Coverage failing before the first score: `failed`, as in slice 3 (`EXTRACTION_FAILED`, `COVERAGE_FAILED`, `INTERNAL`).
- A chain failing inside the loop (tailor, claim check or re-judge still broken after one retry, or `LlmUnavailableError`): undo that round and stop at `awaiting_review` with the last good round's result. Exit reason `error`, a new value in `ExitReasonSchema`. Logged and set on the span.
- If round 1 fails: zero Changes, before = after, exit reason `error`.
- Why: a round's Changes are kept only when the whole round succeeds, so a Run never ends worse than its last good round.
- Rejected: failing the whole Run with `TAILORING_FAILED`.

## Smaller defaults
The owner said yes to all of these.
- **Runner.** The graph runs in the same in-process background task. `POST /runs` is unchanged; the client polls `GET /runs/:id`. No concurrency limit (OpenAI).
- **Statuses.**

  | Status | Shows |
  |---|---|
  | `extracting` | until the first score |
  | `tailoring` | iterations used / max 3, score before and latest |
  | `awaiting_review` | before and after score, before and after verdict per Requirement, Tailored CV, Changes, exit reason, `userEvidence` empty, `confirmedGap` false |

  The `questions` step shows `done` in 4a.
- **Draft CV.** Never stored as a copy: the original CV plus the validated Changes, through one pure `applyChanges`. New Items continue the ID numbering (`exp1.b5` after `exp1.b4`, `skill13`), so the Claim rule still applies to added skills.
- **Tailor input.** The CV with IDs, every Requirement with its verdict and reason, and earlier rejections with reasons. Each Change cites at least one CV Item, lists its Requirements and has a rationale. Structural problems get one retry.
- **Tracing.** The 4a Run is one uninterrupted stretch, so one `pipeline` root span (`session.id` = Run id). Children: `extract_*`, `assess_coverage`, then per round `tailor`, `validate`, `claim_check`, `assess_coverage`, each with a `round` attribute. The root gets `score.before`, `score.after`, `rounds`, `exit_reason`. No content on spans (ADR 0006).
- **Dev script.** `--tailor` runs the whole loop in memory and prints each round (Changes, rejections with reasons, scores) and each Requirement's kind. It gains a `pipeline` wrapper, which closes slice 3's "dev-script runs are ungrouped in Phoenix".
- **Postman.** "Get run (awaiting_review)" replaces "Get run (scored)".
- **No new ADR.** Nothing else is hard to reverse. ADR 0003 and ADR 0004 get slice 4 paragraphs.

## Left for later
- The Job Profile's Requirement count varies between runs. Watch it in manual runs.
- gpt-5 / gpt-6 model IDs (`400 invalid model ID`).
- Slice 1 and 2 leftovers.
- A different judge model, if the claim check proves lenient.
- Slice 7 (frontend) starts with a Claude Design pass before any frontend code is planned. The owner asked for this explicitly and called it very important.

## After implementation
Written at the end of the slice (2026-10-25). The owner approved the two changes below (#16, #17) after manual runs.

### Spec and tickets
They live on GitHub, all as sub-issues of spec [#5](https://github.com/movchaneric/resumeai/issues/5).

| Issues | Origin |
|---|---|
| #6 to #15 | planned in the grilling session |
| #16, #17 | from manual runs |
| #19 | review fixes (`review.md`) |

[#18](https://github.com/movchaneric/resumeai/issues/18) is separate (`needs-triage`), not a sub-issue.

### How it was built
- 13 tickets, each done by a Sonnet agent in its own worktree, made from the slice branch.
- Waves: #6 to #11 in parallel; then #12 → #13 → #14 → #15; then #16, #17 and #19.
- Opus checked each ticket by red-checking (breaking the code to prove the tests fail) before a `--no-ff` merge.
- Red-checking caught one weak test: the checkpointer schema test passed with the wrong schema, because of tables left over from earlier runs. Fixed before the merge.
- The parallel agents shared one test database, which caused flaky failures. Ticket #12 made `TEST_DATABASE_URL` overridable; later agents each used their own test database.

### #16: the tailor stops adding qualities
- Owner decision after the first manual run.
- The tailor proposed 3 Changes. Each appended a quality the job asks for but the CV never states ("working independently", "attention to detail and code quality", "collaborating with engineers across…"). The claim check rejected all 3.
- The tailor prompt now forbids appending qualities, adjectives, soft skills, ways of working, collaboration, ownership, independence or impact. It lists what is allowed, and has one rejected and one accepted made-up example.

### #17: second chance, and the Job Profile on the judge model
Owner decision after the second run.
- **Second chance.** A round with 0 valid Changes ends with `ceiling` only if the previous round also had 0 valid Changes. The exit table's `ceiling` row becomes:

  | Exit reason | When |
  |---|---|
  | `ceiling` | 0 valid Changes in two rounds in a row (none proposed, or all rejected) |

- **Job Profile on gpt-4.1.** The Job Profile extraction moved to the judge model (`LLM_JUDGE_MODEL`). CV extraction stays on gpt-4.1-mini (`LLM_MODEL`).
- Why: on identical input, the score before tailoring moved from 69 to 57.

### Measurements
Dev script `--tailor` on the owner's CV:

| Job | Scores before tailoring | Requirement counts |
|---|---|---|
| first | 69, 57, 54, 65 | 35, 34 on gpt-4.1 |
| second | 49, 43 | 17, 20 on gpt-4.1 |

- The Requirement counts are steadier on gpt-4.1, so the spread now seems to come mostly from Coverage verdicts. That became [#18](https://github.com/movchaneric/resumeai/issues/18) "Match Score varies by up to 15 points on identical input": measure first, then a grill. Not part of 4a.
- Across 6 dev runs and 1 Postman run, the tailor found no Change the claim check accepted.
- Every rejection was a real addition. Examples: "in React" on a Design System bullet, when the CV lists React only as a skill; "SQL query optimization", when the CV lists only SQL.
- Conclusion: 4a works as designed. Gains need facts from the owner (slice 5).

### Postman end to end
2026-10-25, the second job, the owner's newer CV (it has a Projects section).

| Field | Value |
|---|---|
| status | `awaiting_review` |
| score | 48 → 48 (4 met, 13 partially met, 6 unmet of 23) |
| rounds | 2 (round 1: 4 proposed, 4 rejected by the claim check; round 2: none proposed) |
| changes | empty |
| exit reason | `ceiling` |
| time | 22.2 s |

Phoenix: one `pipeline` trace with `session.id` = the Run id and `score.before`, `score.after`, `rounds` and `exit_reason`. Children: `extract_job_profile` 5.2 s, `extract_cv` 6.5 s, `assess_coverage` 5.6 s, `tailor` 2.6 s, `validate` 1.6 s, `tailor` 0.7 s. The counts sit only on our named spans, not on LangGraph's.

### Cost
From the real token counts of that Run:

| Model | Tokens in / out | Cost |
|---|---|---|
| gpt-4.1 | 9,916 / 2,857 | about $0.043 |
| gpt-4.1-mini | 2,151 / 875 | about $0.002 |
| **Total per Run** | | **about $0.045** |

Three times slice 3's $0.015, and under the planned worst case of $0.08. About 100 Runs on the owner's $4.79 balance.

### Idea for slice 5
Every rejected Change, and every "only in the skills list" `partially_met` verdict, points at a fact only the owner can confirm: "Was the Design System built in React?", "Did you optimize SQL queries?". These are natural Question candidates.

### Review
See `review.md`. The fixes went into [#19](https://github.com/movchaneric/resumeai/issues/19). One of them is a test proving that `TRACE_CONTENT=false` keeps CV and Job Description text off LangGraph's spans; it passed without code changes.
