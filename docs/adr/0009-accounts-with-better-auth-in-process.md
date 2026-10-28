# Accounts with Better Auth, in the backend process

Slice 8 adds optional Accounts (email and password, or Google) so a person can keep their Runs in My Runs. Auth runs inside the existing backend with Better Auth, an open-source library, and stores Accounts in our own Postgres, in a Prisma-managed `auth` schema next to `app`. This amends ADR 0002: Runs are no longer all anonymous, and not every Run expires after 7 days. Guest Runs are unchanged.

**Owned Runs.** `runs.account_id` (nullable, referencing `auth`) makes a Run an Owned Run:
- **Only its Account, signed in, can read or act on it.** Anyone else gets a 404, the same as a missing Run, so the link alone no longer opens it.
- **It expires 90 days after it was created** (configurable, like `RUN_TTL_DAYS`). A Guest Run keeps 7 days.
- **At sign-in or sign-up, the browser hands over the IDs of the unexpired Guest Runs it started** (kept in localStorage). They become Owned Runs and get the 90-day expiry from their creation time. Nothing else claims a Run: a pasted link can't, so holding someone else's link never gives ownership.
- **Deleting an Account deletes its Owned Runs and their checkpoints first, then the Account, its sessions and its linked Google account.** It goes through one function, `deleteAccount(id)`. Checkpoints have no foreign key (ADR 0005), so the cascade is explicit.

**Email.** A password Account must verify its email before it can sign in. Google is a trusted provider, so a Google sign-in with the same verified email links into the existing Account rather than creating a second one. Requiring verification first is what makes this linking safe: otherwise someone could pre-register another person's email with their own password and keep it after the owner links Google. Verification and password-reset mail go through an `EmailSender` interface. In development it writes the link to the server log. A real sender (Resend's free tier, which needs an owned domain) is plugged in by the Deployment slice.

**Boundary.** `backend/src/auth/` is the only importer of `better-auth`, enforced by the architecture test. The rest of the backend sees `AccountsService` and the `requireAccount` / `optionalAccount` middleware, which put `{ accountId, name, email }` on the request. Sessions are Better Auth's database sessions in an httpOnly cookie, on the same origin as the API through the `/api` proxy, so there's no CORS and no JWT.

**Consequences.**
- **ADR 0003 assumed Runs live 7 days at most.** With 90 days, a change to the checkpoint state's shape can now meet old checkpoints. Treat a state change as needing either compatibility with old checkpoints, or a decision to delete Owned Runs older than the change.
- **"Download again any time" on the Sign up panel becomes "for 90 days".**
- **Accounts are deleted only on request.** There's no inactivity expiry for Accounts.

**Considered options.**
- **Clerk:** free up to 50,000 monthly retained users, and it sends the emails itself. Rejected: the user records would live with a vendor whose free terms have changed twice, the designed Sign in and Sign up pages would have to be rebuilt on its components or headless API, and Account deletion would span two systems.
- **Supabase Auth, Auth0, Firebase Auth:** the same trade-offs as Clerk, with no better fit for Express and Prisma.
- **Auth as a separate service or repo:** rejected for now. Every Run request, SSE included, needs the session, so a split adds a network hop or JWTs that "Sign out" and "Delete account" can't revoke. Account deletion would become a delete across two services in place of one transaction. And it doubles CI and deployment before any deployment exists.
  - **Split when any of these becomes true:** a second app needs the same sign-in, auth must scale or deploy on its own, or a separate team owns it.
  - **The `auth/` layer, the `auth` schema and `deleteAccount` are the seam** that keeps a split cheap.
