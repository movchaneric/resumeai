# Frontend

Vite, React 19, TypeScript (strict), React Router and TanStack Query, styled with Tailwind v4 (tokens in `src/styles/tokens.css`, from `docs/slices/07b-frontend-core/design-system/MASTER.md`).

```
pnpm dev:web                       # from the root: the dev server (needs `pnpm dev` for the API)
pnpm --filter frontend test        # Vitest, React Testing Library, MSW, vitest-axe
pnpm --filter frontend typecheck
pnpm --filter frontend build
```

Layers, import rules and the tests that enforce them are in "Frontend structure" in the root `CLAUDE.md`. Decisions: `docs/slices/07b-frontend-core/decisions.md`.
