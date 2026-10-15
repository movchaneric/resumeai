# Resume AI: project rules

See `CONTEXT.md` for the domain language, `docs/README.md` for where docs go, and `docs/adr/` for decisions.

## Backend structure

Separate the layers. A feature lives in its own folder under `backend/src/<feature>/`, with one file per layer:

- `<feature>.router.ts`: routes and HTTP middleware (multer, validation of the transport). No logic.
- `<feature>.controller.ts`: the HTTP edge. Reads the request, calls the service, sets the status and response. No business rules and no database access.
- `<feature>.service.ts`: business rules. Knows nothing about Express (no `req`/`res`). Throws `ApiError` to reject.
- `<feature>/…store.ts`: data access (Prisma). Only the store imports the Prisma client.

`app.ts` only wires store -> service -> controller -> router. Cross-cutting HTTP code (error handling) goes in `src/middleware/`. Dependencies are passed in through constructors so layers can be tested alone (a service test uses a fake store; routes are tested with `supertest`).

## Imports

- Inside `backend/src`, import with the `@/` alias, never with relative paths: `import { ApiError } from "@/errors.js"`.
- Keep the `.js` extension (NodeNext module resolution requires it, even for aliased imports).
- Do not use `@/` for other packages: shared code comes from `@resume-ai/shared`.
- `pnpm build` runs `tsc-alias` to rewrite `@/` in the compiled output. Don't add other alias prefixes.

## Workflow

- One branch and one PR per slice. Commit messages end with the Co-Authored-By line.
- Plans, handoffs and reviews go under `docs/slices/<NN>-<name>/`.
- Run `pnpm typecheck` and `pnpm --filter backend test` (needs `docker compose up -d postgres`) before committing.
