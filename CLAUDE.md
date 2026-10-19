# Resume AI: project rules

See `CONTEXT.md` for the domain language, `docs/README.md` for where docs go, and `docs/adr/` for decisions.

## Backend structure

Organise `backend/src` by layer, one folder per layer, with one file per feature in each (`runs.ts` in each folder for Runs). File names are camelCase.

```
backend/src/
  routes/        index.ts mounts each feature's router and wires store -> service -> controller
  controllers/   the HTTP edge: read the request, call the service, set status and response. No business rules, no DB.
  services/      business rules. No Express (`req`/`res`). Throws `ApiError` to reject.
  stores/        data access (Prisma). Only stores import the Prisma client.
  middleware/    cross-cutting HTTP code (error handler, not-found)
  parsing/       CV file parsing
  utils/         config, db client, errors
backend/test/    mirrors src (routes/, services/, parsing/, utils/); fixtures live in test/fixtures
```

- Routers hold routes and transport middleware (multer) only, with no logic.
- `app.ts` builds the Express app; `index.ts` starts the server.
- Dependencies come in through constructors so each layer can be tested alone (a service test uses a fake store; routes are tested with `supertest`).

## Imports

- Inside `backend/src` and `backend/test`, import src code with the `@/` alias, never with relative paths: `import { ApiError } from "@/utils/errors.js"`.
- Keep the `.js` extension (NodeNext module resolution requires it, even for aliased imports).
- Do not use `@/` for other packages: shared code comes from `@resume-ai/shared`.
- `pnpm build` runs `tsc-alias` to rewrite `@/` in the compiled output. Don't add other alias prefixes.

## Workflow

- One branch and one PR per slice. Commit messages end with the Co-Authored-By line.
- Plans, handoffs and reviews go under `docs/slices/<NN>-<name>/`.
- Run `pnpm typecheck` and `pnpm --filter backend test` (needs `docker compose up -d postgres`) before committing.
