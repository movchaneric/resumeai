# 08 A separate model for Coverage

Found in the manual runs (2026-10-24). After ticket 07's stricter prompt, gpt-4.1-mini still wrote reasons such as "…, indicating ability to iterate quickly" and gave `met`, and the owner's CV scored 94. gpt-4.1 with the same prompt scored 65 (15 met, 14 partially met, 4 unmet), gave no inference reasons, and disagreed with the verdict key on 6 of 29 Requirements. Extraction already passes the answer key on gpt-4.1-mini.

Decision (owner): extraction stays on `LLM_MODEL` (gpt-4.1-mini), and Coverage uses a stronger model (gpt-4.1). See `decisions.md`, "Coverage model".

## Changes
- `utils/config.ts`: add `LLM_COVERAGE_MODEL` (optional, non-empty string). Expose it as `config.llm.coverageModel`, defaulting to `LLM_MODEL` when unset, so a single-model setup keeps working.
- `services/runs.ts`:
  - `RunsDeps` gains `coverageLlm?: LlmClient`.
  - `runPipeline` passes `this.deps.coverageLlm ?? this.deps.llm` to `assessCoverage`. Extraction keeps using `llm`.
  - Add a one-line comment saying why there are two clients.
- `index.ts`: build two `LangChainLlmClient`s from `config.llm`: the extraction one with `model`, the Coverage one with `model: config.llm.coverageModel`. Pass both to `createApp`. The other options (key, base URL, timeout, reasoning effort, context) are shared.
- `test/extract.ts`: build the same two clients and use the Coverage one for `assessCoverage`. Print both model names once at the start (`models: extraction <x>, coverage <y>`).
- `.env.example`: in the OpenAI block, `LLM_MODEL=gpt-4.1-mini` and `LLM_COVERAGE_MODEL=gpt-4.1`, with the comment "Coverage is judgement and needs the stronger model; extraction is checked by code". In the Ollama block, a commented `# LLM_COVERAGE_MODEL=` line saying "unset: Coverage uses LLM_MODEL".
- The `LLM_MODEL` default in `ConfigSchema` becomes `gpt-4.1-mini`.

## Tests (test-first)
- `test/utils/config.test.ts`: `coverageModel` defaults to the `LLM_MODEL` value; `LLM_COVERAGE_MODEL` overrides it; an empty string is rejected; the new `LLM_MODEL` default.
- `test/services/runs.test.ts`: with a separate `FakeLlmClient` passed as `coverageLlm`, the `assess_coverage` call goes to it and the extraction calls go to `llm`. A second test covers the case without `coverageLlm`: Coverage uses `llm` (this is the current behaviour, which the existing tests already exercise; one explicit assertion is enough).

## Done when
`pnpm typecheck` and the full `pnpm --filter backend test` pass (Postgres up). One commit ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not run the dev script or the server against a real model.
