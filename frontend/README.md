# Frontend

Vite, React 19, TypeScript (strict), React Router and TanStack Query, styled with Tailwind v4 (tokens in `src/styles/tokens.css`, from `docs/slices/07b-frontend-core/design-system/MASTER.md`).

```
pnpm dev:web                       # from the root: the dev server (needs `pnpm dev` for the API)
pnpm --filter frontend test        # Vitest, React Testing Library, MSW, vitest-axe
pnpm --filter frontend typecheck
pnpm --filter frontend build
```

Layers, import rules and the tests that enforce them are in "Frontend structure" in the root `CLAUDE.md`. Decisions: `docs/slices/07b-frontend-core/decisions.md`.

## Talking to the API

The browser calls `/api/...` on the dev server; `vite.config.ts` forwards it to `http://localhost:3000`, stripping `/api` and leaving `text/event-stream` unbuffered (the backend has no CORS on purpose). Set `VITE_API_BASE` to use another base. Run `pnpm dev` (the API) and `pnpm dev:web` together.

Every response is parsed with the `@resume-ai/shared` zod schemas in `src/api/`; a failure is a typed `ApiError { status, code, message, details }`, and a response that doesn't match the schema is an `ApiError` with code `RESPONSE_PARSE_ERROR`.
