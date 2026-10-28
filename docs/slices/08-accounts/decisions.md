# Slice 8: Accounts, decisions

Settled in the slice 8 grilling (2026-10-28). Every decision is owner-approved. Spec: #83, tickets #84 to #86. The architecture is ADR 0009, and the terms are **Account**, **Guest Run**, **Owned Run** and **My Runs** in `CONTEXT.md`.
- **Design:** `docs/slices/07b-frontend-core/design-system/pages/auth.md`, amended below.
- **State before this slice:** `docs/slices/07c-review/handoff.md`.

## Auth
- **Better Auth, self-hosted, inside the backend.** It costs nothing at any scale, and users stay in our Postgres (ADR 0009 has the comparison with Clerk).
- **Sign up:** Name, Email and Password, with a password of at least 10 characters (Better Auth's default of 8 is raised to match the existing form rule).
- **Sign in:** Email and Password.
- **Google:** "Continue with Google" on both pages. Signing up with Google takes the name from Google.
- **Email verification is required before password sign-in.** A Google sign-in with the same verified email links into the existing Account.
- **"Forgot password?" is a real reset flow.**
- **Email delivery:** an `EmailSender` interface. During this slice, the dev sender writes the verification and reset links to the server log (`backend/logs/dev.log`). Real delivery, through Resend's free tier and an owned domain, comes in the Deployment slice.
- **Sessions:** Better Auth database sessions in an httpOnly cookie. They last 7 days and are renewed each day the app is used. There's no "Remember me".
- **Rate limiting:** Better Auth's rate limiting is on for the auth endpoints.
- **Routes:** under `/api/auth/*` through the existing Vite proxy, on one origin with no CORS.
- **Local only.** The Google OAuth client is registered for `http://localhost:5173`. The production origin belongs to the Deployment slice.

## Structure
- **Not a separate service.** The owner asked whether auth should be its own repo or service. It stays in the backend, and it isn't logged as tech debt. ADR 0009 lists the reasons and the three triggers that would justify a split.
- **`backend/src/auth/`** is the only importer of `better-auth`, enforced in `backend/test/architecture.test.ts`. `CLAUDE.md`'s backend structure gains the layer.
- **The rest of the backend sees `AccountsService`** and the `requireAccount` / `optionalAccount` middleware, which put `{ accountId, name, email }` on the request.
- **Prisma manages a new `auth` schema** next to `app`. `runs.account_id` is nullable and references it.

## Runs and ownership
- **Guests stay.** "Enter as a guest" and Guest Runs work exactly as before: open with the link, 7 days to live.
- **A Run started while signed in is an Owned Run.**
- **An Owned Run can be read or acted on only by its Account, signed in.** Anyone else gets a 404. This covers the view, SSE, Answers, Review, preview, downloads and delete.
- **Owned Runs expire 90 days after creation** (configurable). The Sign up panel's "Download again any time" becomes "for 90 days".
- **Claiming:** at sign-in and sign-up, the browser sends the IDs of the Guest Runs it started (kept in localStorage). The unexpired ones become Owned Runs, with expiry recomputed as created + 90 days. Nothing else claims a Run.
- **Deleting an Account** deletes its Owned Runs and their checkpoints, then the Account, its sessions and its Google link, all through `deleteAccount(id)`.

## Frontend
- **Sign in and Sign up, top to bottom:**
  - "Continue with Google";
  - an "or" divider;
  - the email form;
  - the primary button;
  - the "Enter as a guest →" block and the footer, as today.
- **New pages:** verify email (the landing page for the link), "Forgot password?" (asks for the email) and reset password (sets a new one).
- **Header when signed in:** the name, with the Google avatar if any, opens a menu:
  - "My Runs";
  - "Sign out";
  - "Delete account", behind a confirm dialog: "Deletes your account and all N Runs. This can't be undone."

  There's no settings page in this slice: no changing the name, email or password, and no unlinking Google.
- **My Runs (`/runs`):** newest first, with no search and no paging. Each row has:
  - the job title and company;
  - the date started;
  - a status chip (answering, in progress, in review, done, failed);
  - the Match Score when there is one;
  - the actions: open, download (PDF and DOCX when done) and delete.
- **After sign-in or sign-up:** go back to `?next=`, or to My Runs otherwise.
- **Signed out on an Owned Run's link:** the not-found page adds "If this is your Run, **sign in** to open it", with `?next=` back to the Run.
- **Upload, as a guest:** one quiet line: "As a guest, this Run stays at its link for 7 days. **Sign in** to keep it in My Runs." Signed in, there's no line.

## Tickets (#84 to #86)
- **8a, backend auth:**
  - Better Auth in `auth/`, the `auth` schema;
  - email and password with verification and reset;
  - Google with linking;
  - the dev `EmailSender`, sessions, rate limits;
  - `requireAccount` / `optionalAccount`;
  - the architecture test.
- **8b, Run ownership:**
  - `runs.account_id`;
  - owner-only access on every Run route;
  - the 90-day TTL for Owned Runs;
  - the claim endpoint;
  - `deleteAccount`;
  - the My Runs list API.
- **8c, frontend:**
  - the real Sign in and Sign up with Google;
  - the verify, forgot and reset pages;
  - the account menu and delete dialog;
  - My Runs;
  - Guest Run IDs in localStorage, and the claim at sign-in;
  - `?next=`, the not-found sign-in line, the Upload note.
