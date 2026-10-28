# Handoff: slice 7 done (the frontend)

## Where things stand
Slice 7 is done in three parts. **The product now runs end to end in the browser:** Upload, then Questions, then live Progress, then Review, then Done and download.

| Part | PR | Spec, tickets | What it holds |
|---|---|---|---|
| Design | #78 | | The design system and page specs (`07b-frontend-core/design-system/`), and the decisions for 7a, 7b and 7c |
| 7a, review data | #79 | #61, #64 to #66 | `originalCv` in the view, a faster `measureFit`, and the drop rules moved to shared |
| 7b, frontend core | #80 | #62, #67 to #73 | The SPA, the API layer, live updates, and every screen except Review |
| 7c, Review | #81 | #63, #74 to #77 | Suggesting mode, the top bar, focus mode, and the Word download for a CV that can't fit one page |

### Backend and shared (7a, 7c)
- **The view:** `awaiting_review` and `completed` carry `originalCv`, the extracted CV with no Change applied. `completed` also has `onePage`, computed on read with `fitOf`.
- **`measureFit`:** it tries the normal size, then the floor, then a binary search between them. That's 1 render when the CV fits, 2 when it's over, and at most 5 otherwise.
- **Shared rules:** the browser runs the server's own rules from `@resume-ai/shared`:
  - `cvItems`, `applyChanges`, `applyDecisions`, `keptChanges`, `userDrops`, `dropProblem` and `reviseChange`;
  - the re-judge sets in `rejudge.ts`: `requirementsListedBy`, `touchedItemIds`, `requirementsCiting` and `requirementsAffectedByReview`.
- **Downloads:** for a CV that can't fit one page even at the smallest size, `cv.docx` renders at the floor step. `cv.pdf` stays a 409 `CV_TOO_LONG` (the owner's choice, in `07c-review/decisions.md`).

### Frontend (`frontend/`, 7b, 7c)
- **Stack:**
  - Vite, React 19, TypeScript (strict), React Router and TanStack Query;
  - Tailwind v4 with the Direction B tokens in `src/styles/tokens.css`;
  - Radix primitives, Lucide icons, and Plus Jakarta Sans served from the app itself.
- **Layers:** `api/` is the only code that uses `fetch` or `EventSource`, and every response is parsed with the shared schemas. The other layers are `routes/`, `features/<name>/`, `ui/` and `styles/`. `frontend/test/architecture.test.ts` enforces this, and `CLAUDE.md` has a "Frontend structure" section.
- **Live data:** `useRun` writes each SSE view into the query cache. If the stream breaks it polls every 3s, and after 3 failures in a row it shows "Lost connection. Retrying…".
- **Review** (`features/review/`):
  - **State:** one `useReview(run)` holds a reducer with undo, saved to `sessionStorage` per Run. It provides `canDrop`, `mayChange` and a fit preview that waits 600ms and cancels any request still running.
  - **Desktop (≥ 1024px):** the CV page drawn from `originalCv` with inline marks, Change cards in the margin, a filter rail, and the J, K, A, R, E, D and ⌘Z shortcuts (with an on/off toggle).
  - **Top bar:** the fit chip and popover, the score chip and checklist drawer, and the Submit dialog.
  - **Phones:** below 1024px, focus mode shows the same state one card per Change.
- **Sign in and Sign up:** UI only, with client-side validation. "Accounts are coming soon", and "Enter as a guest" goes to `/`.
- **Tests:**
  - frontend: 277 tests (Vitest, RTL, MSW, with vitest-axe on every screen);
  - shared: 73;
  - backend: 801;
  - `pnpm typecheck` is clean, and CI runs all three suites.

### Docs
- `07a-review-data/decisions.md`, `07b-frontend-core/decisions.md` and `07c-review/decisions.md`, each with its proof result;
- `07b-frontend-core/design-system/` (`MASTER.md` and `pages/`);
- this handoff and `retrospective.md`.

## Running it locally
1. **Start the backend:** `docker compose up -d postgres`, then `pnpm dev` (backend on :3000). Use a shell with no test overrides: `env | grep -E 'TTL|SWEEP'` should print only defaults.
2. **Start the frontend:** `pnpm dev:web` (Vite on :5173). It proxies `/api` to :3000 with the prefix stripped, and passes SSE through unbuffered.
3. **After switching branches, run `pnpm --filter shared build`.** The backend and frontend read the built `shared/dist`. A stale build from another branch makes `GET /runs/:id` fail with a 500 on schema parsing, which the screen shows as "Lost connection".
4. **For proof Runs:**
   - `scripts/proof-run.sh` still works against the API.
   - The long CV for Review is `longCv()` from `backend/test/fixtures/longCv.ts`. Render it outside the repo, and never commit it.
   - `scripts/proof-run.sh --resume` takes the answers as a file. The Question IDs change from Run to Run, so check them first.

## Follow-ups
1. **`INVALID_REVIEW` has no `details`.** The browser reads the Change or Item ID from the message text (`invalidReviewTarget`), so changing the wording in `backend/src/tailoring/review.ts` would silently break it. The fix is to send `{ changeId?, itemId? }` in `details`.
2. **`overByLines` is coarse.** Dropping one 2-line bullet left "8 lines over" unchanged in the API. Entries don't split across pages, so the overflow probably moves in whole blocks. Until that changes, the fit chip can't show progress drop by drop. The 7c proof never reached "Fits" for this reason (see the Proof in `decisions.md`).
3. **The pre-push hook checks `remote_sha..local_sha`.** A remote branch created at an old master pulls master's merge commits into the range, and their messages contain the owner's handle, which is a private name. Fix it by also excluding `origin/master` in `.husky/pre-push`. Until then, push slice branches for the first time only when the work is ready.
4. **Rebuild shared on checkout.** `post-checkout` runs `prisma generate` but doesn't build shared, which caused the stale-build 500 above. Add `pnpm --filter shared build` there.
5. **Questions doesn't notice answers given elsewhere.** `awaiting_answers` neither streams nor polls, so a second tab stays on Questions until it's reloaded.
6. **Two status regions while a toast is open.** A Radix toast adds its own `role="status"`. This was accepted in 7b and 7c, and the screen tests check for one status region only when no toast is showing.
7. **No end-to-end browser tests.** Playwright was deferred in 7b. The proof checks were done by hand in Chrome.
8. **Not checked in a browser:**
   - the `interrupted` and `failed` screens;
   - drag-and-drop on Upload;
   - the `INVALID_REVIEW` round-trip;
   - "See what changed";
   - swipe on a real touch device.

   Tests cover all of these.
9. **Still open from 6c** (`06c-one-page/review.md`): S6, S7, S8. The view and the preview still measure on every read; 7a made each measure cheaper but didn't remove it.
10. **Still open from 6b** (`06b-export/review.md`): S3, S8, S9, P3, P4, and the owner to-dos in `06b-export/handoff.md`.

## Next
The core product is complete, so the next slice is the owner's choice. The candidates, each needing its own spec:
- **Deployment:** serving the SPA in production, the real API origin, CORS, and where Postgres and the model keys live. Deployment was out of scope for all of slice 7.
- **Accounts:** sign in, sign up and "My Runs". The pages exist as UI only. This needs an ADR, because a Run is anonymous today (`CONTEXT.md`, **Run**).
- **Hardening:** follow-ups 1 to 4 above, plus Playwright tests for the main path and the Review.
