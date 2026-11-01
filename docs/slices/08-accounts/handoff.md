# Handoff: slice 8 done (Accounts)

## Where things stand
People can now create an Account, keep their Runs in My Runs, and delete everything in one step. Guests work exactly as before.

| Part | PR | Ticket | What it holds |
|---|---|---|---|
| 8a, backend auth | #88 | #84 | Better Auth in `backend/src/auth/`, the `auth` schema, email and password with verification and reset, Google with linking, sessions, rate limits, `requireAccount` / `optionalAccount` |
| 8b, Run ownership | #88 | #85 | `runs.account_id`, owner-only access (404 for anyone else), the 90-day TTL, claim, My Runs API, `DELETE /account` |
| 8c, claim token and frontend | #88 (backend), this PR | #86 | The claim token on `POST /runs`, the auth pages, the account menu, My Runs, the Guest Run claim, the guest notes |

Spec: #83. Decisions: `decisions.md`. Architecture: ADR 0009.

### Backend
- **`backend/src/auth/`** is the only importer of `better-auth` (enforced in the architecture test). The rest of the backend sees `Account = { accountId, name, email, image }`.
- **Endpoints:** Better Auth under `/api/auth/*`, plus `GET /account`, `DELETE /account` (409 `RUN_BUSY` while a Run works), `GET /runs` (My Runs), `POST /runs/claim`.
- **Claim token:** `POST /runs` returns `{ id, claimToken }` for a Guest Run; only its SHA-256 hash is stored, and a successful claim clears it. A Run's link alone can't claim it.
- **Email:** the dev `LogEmailSender` writes the verification and reset links to `backend/logs/dev.log`.

### Frontend
- **`api/auth.ts`** calls Better Auth's endpoints with plain fetches (no `better-auth` package in the browser); errors arrive as `ApiError` with Better Auth's `code`. `api/account.ts` has the account and My Runs calls.
- **`features/account/`:** `useAccount` (undefined pending, null guest), `safeNext` (same-origin paths only, never an auth page), the Guest Runs in localStorage (`resume-ai.guestRuns`, at most 50, 7 days), and the claim mounted once in `routes/App.tsx`. The claim runs whenever an Account is signed in, so it covers both the password sign-in and the page load after Google's redirect.
- **Pages:** `/sign-in`, `/sign-up`, `/check-email`, `/verify-email`, `/forgot-password`, `/reset-password` (outside AppShell), `/runs` (My Runs, inside it).
- **Header:** "Sign in" with `?next=` for a guest; for an Account, the avatar menu with My Runs, Sign out and Delete account. Sign-out and delete clear every cached server answer, so the next person on the browser sees nothing of the last one's Runs.
- **Tests:** frontend 419, shared 78, backend 905. Typecheck is clean.

## Running it locally
1. `docker compose up -d postgres`, `pnpm dev` (:3000) and `pnpm dev:web` (:5173). `backend/.env` needs `BETTER_AUTH_SECRET` (32+ characters) and, for Google, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. The Google client only accepts `http://localhost:5173`, so test Google sign-in on that port.
2. **Sign up:** the verification link is in `backend/logs/dev.log` (search for `verify-email`). The reset link is there too (`reset-password/`).
3. **Rate limits:** behind the Vite proxy every request shares one bucket. Set `AUTH_RATE_LIMIT=off` in a shell if a proof trips it.

## Follow-ups
1. **Deployment slice:** a separate prod Google Cloud project and OAuth client (`decisions.md`, Local only), real email through Resend, and a trusted client-IP header so rate limits apply per person, not to one shared bucket.
2. **`viewer` is an optional parameter on some `RunsService` methods**, an exception to `CODING_STANDARDS.md` kept so the guest paths read as before. Make it required when the next slice touches those methods.
3. **The privacy hook and GitHub's merge commits:** after a PR merge, branch fresh from master. Pushing a branch that contains GitHub's merge commit is blocked, because the message holds the owner's handle.
4. **GitGuardian** flags dummy test passwords (`backend/test/auth/accounts.test.ts`). The owner dismisses them; there's no ignore file.
5. **Google error codes** on `/sign-in?error=` are mapped by name in `features/auth/errors.ts`. A Better Auth upgrade can rename them, which would only downgrade the message to the fallback line.
