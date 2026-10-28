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

## Settled during implementation
- **Word download for a CV that can't fit one page.** The owner chose to allow it: `cv.docx` is rendered at the smallest size step even when the CV does not fit, while `cv.pdf` stays a 409 `CV_TOO_LONG`. Without this, a Run whose CV is not fittable ends on Done with no file at all, and Done's copy ("Download it anyway as Word") would be false.
- **`onePage` on the completed view.** The `completed` view carries `onePage: boolean`, computed on read with `fitOf` on the Tailored CV (one render when it fits; a Done page is not polled). Done drops "· one page" and shows the notice up front, with Word as the primary button, when it is false.
