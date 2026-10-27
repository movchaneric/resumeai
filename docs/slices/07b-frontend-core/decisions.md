# Slice 7b: frontend core, decisions

Settled in a design pass and a grilling session (2026-10-27); every decision is owner-approved. Spec: #62, tickets #67 to #73. Slice 7 is split into three:
- **7a** (#61): the backend groundwork;
- **7b** (this slice): the frontend core;
- **7c** (#63): the Review screen.

7a and 7b run in parallel, and 7c follows both. Terms follow `CONTEXT.md`, unchanged in slice 7.

## The design pass
- **Tools:** UI UX Pro Max (v2.15.0) for the design system, and Claude Design for the mockups. The mockups are throwaway reference on a private canvas, "Resume AI screens", outside the repo.
- **Direction B, "Modern":** chosen after a first, "Classic" direction (A) that the owner found fine but not what they expected.
  - **Look:** zinc neutrals and one indigo accent, Plus Jakarta Sans, light mode only.
  - **Review:** "suggesting mode" on desktop, "focus mode" on phones.
  - **Questions:** one per screen.
  - **Keyboard:** shortcuts, which can be turned off.
- **The design system** is `design-system/MASTER.md`, with page specs in `design-system/pages/`. The page files override MASTER, and MASTER overrides the mockups.
- **Copy uses only data the API returns.** Unsupported mockup details were removed: a PDF page count, the Requirement text on Questions, step counts, lines saved per drop.

## Scope decisions
- **The app opens on Upload (`/`),** with "Sign in" in the header.
- **Sign in and Sign up are UI only:**
  - client validation;
  - a valid submit says "Accounts are coming soon";
  - "Enter as a guest" goes to `/`;
  - no stored flag, no network call.

  Real accounts need their own spec and an ADR, since a Run is anonymous today. "Guest" isn't a domain term until then.
- **Until 7c, `awaiting_review`** shows a placeholder: the score and the number of Changes. **Done's "See what changed"** is a disabled "coming soon" link.
- **Deployment** (production serving, the real API origin, CORS) is out of slice 7. The slice ends working locally against `pnpm dev`.
- **Browsers:** current evergreen browsers, last two versions, no polyfills.

## Stack
- Vite, React, TypeScript (strict), React Router, and **TanStack Query** for all server data:
  - `GET /runs/:id` is a query;
  - SSE events write into its cache (`setQueryData`);
  - `refetchInterval` polling is the fallback;
  - answers, submitting the Review, the fit preview and deleting are mutations.
- **Tailwind v4,** with the tokens as CSS variables in `@theme`, plus **Radix primitives** (dialog, popover, drawer, toast, radio groups). No component library.
- **Plus Jakarta Sans,** self-hosted with `@fontsource-variable`, so there's no request to Google from a page that takes CVs. **Lucide** icons.

## The API boundary
- **Proxy:** a Vite dev proxy forwards `/api/*` to `localhost:3000`, stripping `/api`. The backend has no CORS, and the screens and API both use `/runs/...`, so the prefix keeps them apart. The base is `VITE_API_BASE`, default `/api`. The proxy must pass `text/event-stream` through unbuffered.
- **Parsing:** every response is parsed with the `@resume-ai/shared` zod schemas at the `api/` edge. A mismatch shows a plain error screen.

## Structure and tests
- **`src/` layers:**
  - `api/` is the only place with `fetch` or `EventSource`;
  - `routes/`;
  - `features/<name>/`;
  - `ui/` holds the primitives and imports no features, routes or api;
  - `styles/` holds the tokens, and no other folder has raw hex colors.
- **Enforcement:** these rules go in `CLAUDE.md`, checked by `frontend/test/architecture.test.ts`.
- **Tests:** Vitest, React Testing Library and MSW, with fixtures built from the shared schemas. **`vitest-axe`** runs in each screen test (no violations at serious or above). CI adds the frontend typecheck and tests. Browser end-to-end tests (Playwright) come later.

## Proof
A real Run through the browser, from Upload to Questions to Progress to the Review placeholder, plus the failure paths (a scanned PDF, a Job Description that's too long). Screenshots and notes go here when done.
