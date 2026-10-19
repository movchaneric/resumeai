# Slice 1 retrospective: what didn't go as planned

An honest log of the detours, kept for the project story. For each one: what happened, how it was handled, and whether it is actually fixed. The planned decisions are in `decisions.md`; the review findings are in `review-code.md`.

## Plan versus ADRs
**The handoff contradicted the ADRs.** The slice 0 handoff said `POST /runs` "saves the files", but ADR 0002 says uploads are deleted right after parsing, and ADR 0003 says run data lives only in the graph checkpoint, which doesn't exist until slice 4. So parsed text had nowhere to live.
- Handled: transitional `cv_text` and `jd_text` columns in `runs`, files parsed in memory and never saved (ADR 0003 addendum).
- Status: **fixed by design, but it is debt.** Slice 4 must move the text into graph state and drop the columns.

## Environment problems
**A native Postgres shadowed the Docker one.** `localhost:5432` was served by a Postgres installed on the machine, so Prisma failed with `P1010` (access denied) and `P1000` (authentication failed) against the wrong server. Remapping the container to 5433 and 5434 also failed with a Docker "port already in use" error even though nothing was listening there; recreating the container didn't help. Host port 15432 worked.
- Status: **worked around, root cause not found.** The Docker port change is in `docker-compose.yml` and `.env.example` and is called out in the PR.

**Docker Desktop stopped twice mid-session.** The daemon disappeared and the database became unreachable until Docker was restarted. Not a project bug, but "start Docker first" is in the handoff for a reason.

**Prisma versions didn't match.** `pnpm add` installed the CLI as `8.0.0-rc.22` (a release candidate) next to client 7.10. Pinned both to 7.x. pnpm also blocked Prisma's build scripts until they were allowed in `pnpm-workspace.yaml`.
- Status: **fixed.** Revisit when Prisma 8 is stable.

## Process and structure
**The first version put routes, handlers and rules all in `app.ts`.** The project owner asked for a clear separation. It was refactored twice: first into feature files (router, controller, service), then into layer folders (`routes/`, `controllers/`, `services/`, `stores/`) mirroring the owner's `policy_agent_vecdb` backend, with camelCase names and tests mirrored under `backend/test/`.
- Status: **fixed**, and the rules are in `CLAUDE.md`. Lesson: the grilling session decided libraries and limits but never asked about code structure. Ask it up front next time.

**`@/` imports had two catches.** With NodeNext module resolution an aliased import still needs the `.js` extension, and `tsc` doesn't rewrite `@/` paths, so the compiled `dist` would crash. Fixed with `tsc-alias` in the build, checked by starting `dist/index.js`.

**Not strictly test-first.** The parsers and the shared schema change were written test-first. The endpoints and the service were written before their integration tests (which then passed on the first run). The tests exist and cover the behaviour, but the red step was skipped for that part.

## Things the tests didn't catch
**The Postman collection sent no files at first.** The fixture paths were relative to `postman/`, but Postman resolves them against its working directory, so every upload returned `400`. Found when running newman; fixed by using repo-root paths and documenting the working-directory setting. The owner then also hit it from the other side: pasting a file path into Postman's import box instead of the file contents.

**A library API was misremembered.** `destroy()` is on the PDF's loading task, not the document proxy; the typecheck caught it.

**Synthetic fixtures were too clean.** All tests passed, then the owner's real two-column CV showed the parser returns text in storage order, not reading order: sections shuffled, dates glued to the next line (for example a date range followed immediately by a job title), headings detached from their content.
- Status: **not fixed, deliberately.** The parser did what slice 1 asked. It is the first task of slice 2 (handoff), because wrong dates would defeat ADR 0004's rule that dates and titles never change. Lesson: test with a real document early, not only generated ones.

## Code review (details in `review-code.md`)
Ten findings. Fixed: PDF cleanup, NUL characters crashing inserts, the scanned-PDF check counting separators, multer limits, error handler edge cases, graceful shutdown.
Left open on purpose, **to fix before untrusted public traffic:** expired Runs and their CV text stay in the database until the slice 5 sweep, and the 10-second parse timeout stops waiting but doesn't stop the work (zip-bomb risk). `toRunView` always reporting `extracting` is intentional until slice 2.

## PR review round: rules I wrote and then broke
After the PR was open, a two-axis review (standards and spec) found problems my own checks had missed, several of them violations of rules written earlier in the same slice:
- **File naming:** `CLAUDE.md` says one file per feature per layer, but I had `runStore.ts` and a second services file, `runView.ts`. Renamed to `stores/runs.ts`; `toRunView` moved into `services/runs.ts`.
- **"JD" in names:** `CONTEXT.md` says to avoid "JD", yet the column, field and config were all called `jd_text` and `MAX_JD_CHARS`. Renamed with a new migration (not by editing the first one, so existing dev databases keep their data).
- **Prisma outside stores:** a route test queried Prisma directly, against the rule that only stores import it. It now uses `RunStore.count()` and `deleteAll()`.
- **The test database was never created.** The spec said integration tests run on a real `resume_ai_test`, and I had created it by hand once. A vitest `globalSetup` now creates and migrates it on every run (checked by dropping the database and re-running).
- **Two clocks:** `expiresAt` came from the app clock but `createdAt` from the database default, so a Run lasted only roughly the TTL. Both now come from one injected clock, and the test asserts the exact difference.
- **Naive DOCX detection:** searching the bytes for `word/document.xml` let any ZIP containing that text through to mammoth and come back as `EXTRACTION_FAILED`. It now reads the ZIP's file list, so those return `UNSUPPORTED_FILE`.
- **Unknown paths** returned `RUN_NOT_FOUND`; they now return `NOT_FOUND`.
- **Left open on purpose:** the `Deps` type defined in three places, `StoredRun.status` typed as a plain string, the CV and Job Description checks split across layers, where `JOB_DESCRIPTION_TOO_LONG` lives, missing tests for an encrypted PDF and the parse timeout, and the fixture script's location (see the handoff).
- Lesson: run the standards review before opening the PR, not after. The first review (`review-code.md`) looked for bugs, and this one looked for rule violations; both are needed.

## Summary
Everything slice 1 set out to do works and is tested (34 backend, 26 shared, and the Postman collection 11/11, re-run after the review fixes). The honest gaps: one workaround with an unexplained cause (the port), one debt to repay in slice 4 (transitional text columns), and one real-world problem found late and handed to slice 2 (CV reading order).
