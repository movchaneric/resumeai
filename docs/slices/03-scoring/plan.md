# Slice 3 plan: Coverage and the Match Score

Reasons for every choice are in [`decisions.md`](./decisions.md). Terms follow `CONTEXT.md`.

## Goal
After extraction, judge every Requirement against the CV (Coverage: met, partially met or unmet, with cited Evidence and a reason), compute the Match Score from those verdicts, and show both on the Run. Move development from local Qwen to OpenAI, with the model chosen by measuring.

## Behaviour seen from outside

### `GET /runs/:id` over a Run's life
| Moment | `status` | Steps (parse, extract, coverage; the rest pending) | Extra fields |
|---|---|---|---|
| extracting | `extracting` | done, running, pending | `job: null` |
| Coverage running | `extracting` | done, done, running | `job` |
| done | **`scored`** | done, done, done | `job`, `score` (whole number), `requirements` |
| extraction failed | `failed` | done, **failed**, pending | `error` |
| Coverage failed | `failed` | done, done, **failed** | `error` |

`requirements` in `scored`: one entry per Requirement, in Job Profile order: `{ id, text, importance, verdict, evidenceIds, reason }`.

Which step failed is derived: when `cv` and `job_profile` are stored, Coverage failed; otherwise extraction failed.

### Failure codes
| Cause | Code | Message |
|---|---|---|
| Coverage answer still structurally broken after one retry | `COVERAGE_FAILED` (new) | "We couldn't assess your CV against this job. Try again." |
| Timeout, model unreachable, prompt too large (any step) | `INTERNAL` | unchanged |
| Slice 2 codes | unchanged | unchanged |

## Changes by area

### `shared/`
- `StepStateSchema`: add `failed`.
- `RunErrorCodeSchema`: add `COVERAGE_FAILED`.
- `RunViewSchema`: new variant `status: "scored"` with `job`, `steps`, `score: ScoreSchema` and `requirements: ScoredRequirement[]`, where `ScoredRequirementSchema = { id, text, importance, verdict, evidenceIds, reason }` (built from `RequirementSchema` and `CoverageSchema` picks). Comment it as transitional until slice 4.
- Schema tests for the new variant, the new step state and the new code.

### `backend/src/prompts/renderCv.ts` (new, pure)
- `renderCv(cv: Cv): string`: sections in a fixed order with `## <Section>` headings (an additional section uses its own title). Every Item on its own line, starting with `[<id>]`. A job line shows title, company and dates (`2021-03 – present`); bullets are indented under their parent. Empty sections are left out.
- `renderRequirements(requirements: Requirement[]): string`: one line each, `[req1] (must-have) <text>`.
- Imports only `@resume-ai/shared` types.

### `backend/src/scoring/` (new)
- `weights.ts`: `IMPORTANCE_WEIGHTS = { must_have: 3, nice_to_have: 1 }`, `VERDICT_CREDITS = { met: 1, partially_met: 0.5, unmet: 0 }` (ADR 0004).
- `matchScore.ts`: `matchScore(requirements, coverage): number`, which returns `100 × Σ(weight × credit) / Σ(weight)` unrounded. A Requirement with no verdict counts as unmet (it should not happen; the checks prevent it). The caller rounds for display.
- `coverageRules.ts` (pure):
  - `coverageIssues(requirements, cv, answer): string[]`: the structural checks from `decisions.md` (missing, duplicate or unknown Requirement; unknown Evidence ID; `met`/`partially_met` with no Evidence). Issue lines are `req3: …`, readable for the retry message.
  - `applyClaimRule(requirements, verdicts): { coverage: Coverage[]; downgrades: number }`. A `met` verdict whose Evidence IDs are all Claims (`summary` or `skillN`) becomes `partially_met` with the fixed reason from `decisions.md`, unless the Requirement's `kind` is `language`. Everything else, including `contact` and `secN.iM`, counts as shown in use.
  - A helper that collects every Item ID in a `Cv` (reuse one from `extraction/` if it exists).
- `errors.ts`: `CoverageError(message, issues)`, like `ExtractionError`.
- `assessCoverage.ts`: `assessCoverage(llm, cv, requirements): Promise<{ coverage: Coverage[]; downgrades: number }>`.
  - The model schema, backend-only: `{ verdicts: [{ requirementId: string, reason: string, evidenceIds: string[], verdict: "met" | "partially_met" | "unmet" }] }`, fields in exactly that order (decisions.md: reason before verdict).
  - The system prompt states the rules: judge only the listed Requirements, one verdict each; cite Item IDs exactly as shown; met needs an Item that shows the Requirement in use, and the skills list or summary alone is at most partially met (languages excepted); a duration is met only when the cited Items' dates prove it, and a bare year cannot; reason in 1 to 2 sentences; never invent experience.
  - User message: `renderRequirements(requirements)` and `renderCv(cv)`.
  - Flow: call (`name: "assess_coverage"`). An `LlmSchemaError` or a non-empty `coverageIssues` triggers one retry with the issues fed back, the same message pattern as extraction. A second failure throws `CoverageError`. Then `applyClaimRule`, then map the result into `Coverage[]` in Requirement order. `LlmUnavailableError` is not retried.
  - Wrapped in `withSpan("assess_coverage", …)` with `coverage.retries`, `coverage.downgrades`, and `coverage.met`, `coverage.partially_met`, `coverage.unmet` (counts).
- Imports `LlmClient` and `withSpan`, never LangChain.

### `backend/src/utils/spans.ts`
- `withSpan(name, fn, options?: { attributes?: Attributes })`: attributes are set when the span starts.
- Rename `extraction.failure_reason` to `failure_reason`; update the extraction span tests.

### `backend/src/services/runs.ts`
- `extractRun(id)` becomes `runPipeline(id)`, wrapped in `withSpan("pipeline", …, { attributes: { [SemanticConventions.SESSION_ID]: id } })`. Steps: extract the Job Profile, extract the CV, `saveExtraction`, `assessCoverage(llm, cv, jobProfile.requirements)`, `saveCoverage`, then set the unrounded `score` attribute on the span.
- `failureCode` maps `CoverageError` to `COVERAGE_FAILED`, with its `FAILURE_MESSAGES` entry. The safe failure log stays (code, error name, issue count).
- `toRunView` handles `scored` (with `score: Math.round(matchScore(...))` and `requirements`), the Coverage-running state and the failed step, following the table above. Update its doc comment: the "failed shows done" caveat is gone.

### `backend/src/stores/runs.ts` and Prisma
- Migration: nullable `coverage JSONB` on `app.runs`. Update the schema comment (transitional, ADR 0003 slice 2 extension).
- `StoredRun.coverage: Coverage[] | null`, parsed with `z.array(CoverageSchema)` on read.
- `saveCoverage(id, coverage)`: stores `coverage` and sets `status` to `scored`.

### `backend/src/llm/` and config
- `LLM_REASONING_EFFORT` (optional string). `LangChainLlmClient` sends `modelKwargs: { reasoning_effort }` only when it is set. Send `temperature: 0` only when the effort is unset or `none`: OpenAI rejects `temperature` on a reasoning model whose effort is not `none`. gpt-4o-mini and gpt-4.1-mini reject `reasoning_effort` altogether, so they leave it unset; gpt-6-luna and Qwen use `none`.
- Defaults follow the hosted path: `LLM_MODEL` default `gpt-4o-mini`, `LLM_CONTEXT_TOKENS` default `128000`, `LLM_TIMEOUT_MS` default `60000`.
- `.env.example`: an OpenAI block (active) and an Ollama block (commented: base URL, `qwen3:14b`, `16384`, `180000`, `LLM_REASONING_EFFORT=none`, the `ollama serve` command), with a note to upload one CV at a time on Ollama.

### `CLAUDE.md`
- Add `scoring/` and `prompts/` to the backend structure, with `scoring/` under the same rule as `extraction/`.

### Dev script (`backend/test/extract.ts`)
- `--coverage`: after extraction, run `assessCoverage` and print, for each Requirement: id, importance, text, verdict, Evidence IDs and reason. Then the downgrade count, the rounded and unrounded score, and the time.
- `--coverage --check`: also compare with `<job-description path without extension>.coverage.json` next to the Job Description. The key is a list of `{ requirement: string, verdict }`. Match each entry to a Requirement by normalized text: case-insensitive, and the key's text contained in the Requirement's text or the reverse. Print `expected X, got Y` lines and keys that match nothing. Mismatches are warnings and don't change the exit code. The existing CV `--check` still fails on a mismatch.
- The comparison is a pure function in `test/extractCheck.ts` (or a sibling), unit-tested.

### Postman
- The extraction request polls until `status` is `scored` (or `failed`) and checks `score` and `requirements`.

## Tests
No test calls a model. Use `FakeLlmClient` with call name `assess_coverage`.

| Area | Cases |
|---|---|
| `prompts/renderCv` | every section type renders with its IDs; bullets are indented under their parent; an additional section uses its title; empty sections are left out; dates read `YYYY-MM – present`; `renderRequirements` format |
| `scoring/matchScore` | the decisions example (3 must-haves met/partial/unmet + 2 nice-to-haves met/unmet = 50); all met = 100; all unmet = 0; a missing verdict counts as unmet |
| `scoring/coverageRules` | each structural issue on its own; a clean answer gives no issues; `met` with only `skill2` becomes partially met with the fixed reason; `met` with `skill2` and `exp1.b1` stays met; `met` with only `summary` on a `language` Requirement stays met; `met` with only `sec1.i1` stays met; the downgrade count |
| `scoring/assessCoverage` | valid first try; a structural issue then valid (the retry message lists the issues); a schema error then valid; two failures give `CoverageError`; `LlmUnavailableError` is not retried; a downgrade is applied and counted; output follows Requirement order; the prompt contains the rendered CV and Requirements |
| spans | `assess_coverage` attributes; `withSpan` attributes; `failure_reason` rename; a `pipeline` root with `session.id` = the Run id, with the extraction and Coverage spans as its children |
| `llm/langChainLlmClient` | `reasoning_effort` in the request body only when set; `temperature` absent when the effort is set to anything but `none` |
| `utils/config` | new defaults; `LLM_REASONING_EFFORT` optional |
| `services/runs` (fake store, fake LLM) | success ends `scored` with coverage saved; `CoverageError` gives `COVERAGE_FAILED` with the extraction kept; `toRunView` for every row of the table above, including the rounded score |
| `routes/runs` (supertest, real test DB) | `POST`, wait for the background task, then `GET` shows `scored` with `score` and `requirements`; a Coverage failure shows `failed` with `coverage: failed` |
| `extractCheck` (coverage key) | match by text both ways; a mismatch line; an unmatched key |
| `shared` schemas | `scored` variant; `failed` step state; `COVERAGE_FAILED` |

## Manual checks (owner)
1. Put your OpenAI key in `backend/.env` (never committed) and switch to the OpenAI block.
2. **Model comparison:** `pnpm --filter backend extract local-cvs/<cv>.pdf local-cvs/<job>.txt --check` with `LLM_MODEL` set to gpt-4o-mini, gpt-4.1-mini, then gpt-6-luna (with `LLM_REASONING_EFFORT=none`). Keep the cheapest that passes, and record the result and times in `decisions.md`.
3. Write `local-cvs/<job>.coverage.json` by hand (your expected verdict per Requirement), then run `--coverage --check` and read the warnings.
4. `pnpm --filter backend dev`, upload through Postman, poll until `scored`, and check the score and verdicts.
5. Phoenix: one `pipeline` trace with the three spans under it. The Sessions tab shows the Run id. Read the token counts and update the cost estimate per Run.

Do steps 2 to 5 **before** the review, not after (slice 2 retrospective).

## Out of scope
Questions, tailoring and re-judging (slice 4, which reuses `assessCoverage` with a subset); the graph and checkpointer; a queue or concurrency limit; computing durations in code; batching Coverage calls; an eval set; any frontend (slice 6, which starts with Claude Design).
