# 01 OpenAI settings

Plan: "`backend/src/llm/` and config". Decisions: "Model: OpenAI, measured first".

## Goal
The same code runs against OpenAI (gpt-4o-mini, gpt-4.1-mini, gpt-6-luna) and against local Ollama, chosen by `.env` only.

## Facts (from OpenAI's docs, checked 2026-10-24)
- Non-reasoning models (gpt-4o-mini, gpt-4.1-*) reject `reasoning_effort`.
- GPT-6 Luna accepts `reasoning_effort: "none"`.
- When the reasoning effort is anything other than `none`, `temperature` must not be sent.

## Changes
- `utils/config.ts`: add `LLM_REASONING_EFFORT` (optional, non-empty string) to `ConfigSchema` and to `config.llm` as `reasoningEffort?: string`. Change the defaults: `LLM_MODEL` `gpt-4o-mini`, `LLM_CONTEXT_TOKENS` `128000`, `LLM_TIMEOUT_MS` `60000`.
- `llm/langChainLlmClient.ts`: `LangChainLlmOptions` gains `reasoningEffort?: string`.
  - Pass `modelKwargs: { reasoning_effort }` only when it is set.
  - Pass `temperature: 0` only when it is unset or `"none"`.
  - Replace the comment above `modelKwargs` with one that states both rules and why.
- `.env.example`: an active OpenAI block (no `OPENAI_BASE_URL`, `OPENAI_API_KEY=` empty with a comment to put the real key only in `backend/.env`, `LLM_MODEL=gpt-4o-mini`, `LLM_CONTEXT_TOKENS=128000`, `LLM_TIMEOUT_MS=60000`, a commented `# LLM_REASONING_EFFORT=none` with "for gpt-6-luna; leave unset for gpt-4o-mini and gpt-4.1-*").
  - Below it, a commented Ollama block: `OPENAI_BASE_URL=http://localhost:11434/v1/`, a dummy key, `LLM_MODEL=qwen3:14b`, `LLM_CONTEXT_TOKENS=16384`, `LLM_TIMEOUT_MS=180000`, `LLM_REASONING_EFFORT=none`, the existing `ollama serve` command and settings comments, and "With Ollama, upload one CV at a time; a second concurrent Run may time out."
- If the client's option shape changes how `index.ts` or `test/extract.ts` build it, update them; `config.llm` should pass through unchanged.

## Tests (test-first)
- `test/llm/langChainLlmClient.test.ts`, with the existing fake `fetch` that captures the request body:
  1. no `reasoningEffort`: the body has no `reasoning_effort` and has `temperature: 0`
  2. `reasoningEffort: "none"`: the body has `reasoning_effort: "none"` and `temperature: 0`
  3. `reasoningEffort: "low"`: the body has `reasoning_effort: "low"` and no `temperature`
- `test/utils/config.test.ts`: the new defaults; `LLM_REASONING_EFFORT` passes through; an empty string is rejected.

## Done when
`pnpm typecheck` and `pnpm --filter backend test` pass (Postgres up). One commit. The owner's `backend/.env` is not touched.
