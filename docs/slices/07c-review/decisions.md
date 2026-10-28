# Slice 7c: the Review screen, decisions

Settled in the slice 7 grilling (2026-10-27); every decision is owner-approved. Spec: #63, tickets #74 to #77. It needs 7a (#61: `originalCv`, the shared drop rules, the faster fit check) and 7b (#62: the frontend core).
- **Design:** `docs/slices/07b-frontend-core/design-system/pages/review.md` and `MASTER.md`.
- **Stack and structure:** `docs/slices/07b-frontend-core/decisions.md`.

## Interaction
- **Desktop, "suggesting mode":**
  - the CV page drawn from `originalCv`, with inline marks;
  - Change cards in the margin, the selected one expanded with its rationale, "Based on" Evidence and Requirements;
  - a filter rail;
  - a sticky top bar with progress, the fit chip and popover, the score chip and checklist drawer, and Submit.
- **Phones and tablets (< 1024px), "focus mode":** one Change per card, with big decision buttons. It's in v1, as its own ticket (#77), on the same state as desktop.
- **Shortcuts:** J and K, A, R and E, D, and ⌘Z. They work only outside text fields, and a toggle turns them off (WCAG 2.1.4).

## Decisions and state
- **Every Change starts accepted** (matching the view's `fit`), and Submit is never blocked. "Reviewed" counts the Changes looked at, and the confirm dialog gives the totals.
- **One reducer** holds the decisions, revisions, drops, the reviewed set and an undo stack. It's saved to `sessionStorage` per Run.
- **Drops** use the shared `dropProblem`, so the client's "can I drop this?" matches the server. The server still decides.

## The score and checklist
- **They show the result as proposed** (every Change accepted). There's no live re-score, which would cost model calls.
- **"May change" marks,** computed in the browser, flag the Requirements the submit will re-judge. These are the same three sets as `final_rejudge`:
  1. a Change listing the Requirement is rejected or revised;
  2. its Evidence cites an Item an undone Change touched;
  3. its Evidence cites a dropped bullet.
- **No PDF thumbnail** in v1. The fit chip and popover answer the page question.

## The fit preview
- **On load,** the view's `fit` is used with no call. Each change after that is debounced 600ms, then calls `POST /runs/:id/review/preview` and aborts any request in flight.
- **Submit errors:**
  - **400 `CV_TOO_LONG`** sets the fit from `details.overByLines` and opens the popover.
  - **400 `INVALID_REVIEW`** focuses the named Change.
  - **`fittable: false`** shows a note, and never blocks.

## Proof
A full browser Run on the long synthetic CV (`backend/test/fixtures/longCv.ts`, rendered outside the repo, never committed):
- Review starts over one page;
- drops and rejections bring it to "Fits";
- a `CV_TOO_LONG` round-trip works;
- submit, then download a one-page PDF;
- focus mode is checked at 390px.

**Result (2026-10-28).** I checked in Chrome against `pnpm dev` with real model calls and the long CV (Word), plus a made-up Job Description. The answers were posted through the API, since Questions was already proven in 7b.
- **Run 1:**
  - At `awaiting_review` it had 28 Changes, a score of 66 → 84, and a fit of `{ fits: false, overByLines: 19, fittable: false }`.
  - The Review loaded from `originalCv` with every op marked, the cards in the margin, and the rail counts and Requirements summary.
  - Submitting with everything accepted was accepted, because the CV wasn't fittable, and the Run completed.
  - Both downloads were 409, so the Run ended on Done with no file. That led to the Word-download decision above.
  - After the fix, Done shows the notice up front, makes Word the primary button and doesn't say "one page". `cv.docx` returns 200 and `cv.pdf` returns 409.
- **Run 2:**
  - It had 38 Changes, a score of 77 → 93, and a fit of `{ fits: false, overByLines: 8, fittable: true }`.
  - **Submitting while over:** a 400 `CV_TOO_LONG` opened the fit popover with the message and moved focus into it, and the chip read "8 lines over one page".
  - **Drop with D:** dropping a cited bullet asked for confirmation first. The bullet was then struck, a "Dropped by you" card and an Undo toast appeared, the chip showed "Checking fit…", and the result matched the API. The drop survived a reload.
  - **Focus mode at 390px:** one card per Change titled "Use this rewording?", Reject and Accept at 48px, Previous, "See the whole CV" and Skip, one status region and no horizontal scroll.
- **Found and fixed (293f2e0):**
  - The bullet marker sat on the last line of a changed bullet.
  - The app shell header with its own Run actions showed above the Review top bar. Now the shell shows only the brand and "Sign in" during Review.
- **Not reached:**
  - **"Fits":** reaching it through drops and rejections, then downloading a one-page PDF. Dropping one 2-line bullet left `overByLines` at 8, in the API as well as on screen. The measure seems to move in whole blocks, because entries don't split across pages. So getting under one page needs many decisions, and it wasn't finished in this check. The fits path is covered by the route and screen tests.
  - **Not checked in a browser:** the `INVALID_REVIEW` round-trip (tests only), swipe on a real touch device, and "See what changed" (tests only).
- **Follow-ups:**
  - **`INVALID_REVIEW` gives no `details`:** the browser finds the Change from the message text. The backend should send the ID in `details`.
  - **The over-by-lines figure is coarse:** it doesn't move for a single drop. Worth a look in the export measure.

## Settled during implementation
- **Word download for a CV that can't fit one page.** The owner chose to allow it: `cv.docx` is rendered at the smallest size step even when the CV does not fit, while `cv.pdf` stays a 409 `CV_TOO_LONG`. Without this, a Run whose CV is not fittable ends on Done with no file at all, and Done's copy ("Download it anyway as Word") would be false.
- **`onePage` on the completed view.** The `completed` view carries `onePage: boolean`, computed on read with `fitOf` on the Tailored CV (one render when it fits; a Done page is not polled). Done drops "· one page" and shows the notice up front, with Word as the primary button, when it is false.
