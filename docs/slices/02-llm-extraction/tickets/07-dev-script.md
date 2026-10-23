# 07 Dev script and `--check`

**Goal:** the owner can run extraction on a local CV in one command, see what the model received and returned, and check the protected facts against a hand-written answer key.

**Waits for:** 04 and 05. Runs in parallel with 06.

**Plan sections:** "Wiring and scripts" (dev script and `.env.example`) and "Manual checks" in `../plan.md`. Background: "Dev script" and "Quality checks" in `../decisions.md`.

## What to build

1. **`backend/test/extract.ts`** (next to `make-fixtures.ts`), with the script `"extract": "tsx test/extract.ts"` in `backend/package.json`:
   - `pnpm --filter backend extract <cv-file> <job-description-file> [--check]`. Paths are relative to the repo root, so resolve them from the caller's working directory, or document that `pnpm --filter` runs from `backend/`. Pick whichever works and say so in the usage text.
   - Load config the same way `index.ts` does (dotenv plus `loadConfig`), set up tracing, and build `LangChainLlmClient`.
   - Parse the CV with `parseCv` and print the reconstructed text between clear markers.
   - Run `extractJobProfile`, then `extractCv`. Print each result as formatted JSON, the CV's `softMismatches`, and the wall-clock time of each call.
   - On failure, print the error type and its issues, and exit non-zero.
   - It uses no HTTP and no database.
2. **`--check`:** read `<cv path without extension>.expected.json` next to the CV. The shape is protected facts only:
   ```json
   {
     "experience": [{ "company": "…", "title": "…", "start": "2023-02", "end": null, "current": true, "bullets": 4 }],
     "education": [{ "institution": "…", "degree": "…", "start": null, "end": "2025" }],
     "certifications": ["…"]
   }
   ```
   Validate it with a small Zod schema. Compare in order, with exact string equality after trimming. Print each mismatch as `experience[1].start: expected 2021-06, got 2023-01`, plus missing or extra entries. Exit non-zero on any mismatch. Bullet text and the summary are never compared, only bullet counts.
3. **`.env.example`:** add `LLM_MODEL=qwen3:14b`, `LLM_CONTEXT_TOKENS=16384`, `LLM_TIMEOUT_MS=180000` and `TRACE_CONTENT=true` (with a comment: local only, refused when `NODE_ENV=production`, see ADR 0006). Add a comment block with the Ollama start command and why each setting is there:
   `OLLAMA_CONTEXT_LENGTH=16384 OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 ollama serve`.

## Tests
- The comparison is a pure function (for example `compareToExpected(cv, expected) => string[]`) with a unit test in `backend/test/extract.test.ts`: all match; a wrong date; a missing job; a wrong bullet count.
- The script itself is checked by hand by the owner.

## Acceptance
- `pnpm typecheck` passes; the comparison test passes.
- `pnpm --filter backend extract` with no arguments prints usage.
- Nothing from `local-cvs/` is read at test time or committed.
