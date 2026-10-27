# Page: Review (`/runs/:id`, status `awaiting_review`)

The heart of the product. Direction B, "suggesting mode". Mockup boards: "B · Review (suggesting mode)" and "B · Review on a phone (focus mode)".

## Purpose
The user decides on every Change at once (accept, reject or revise), may drop more bullets, and sees whether the result fits one page before submitting. The Review is final.

## Layout, desktop (≥ 1024px)
1. **Sticky top bar,** full width, 90% white with a blur. From left to right:
   - **The title block:** "Review" over the job line.
   - **Progress:**
     - the text "18 of 24 reviewed";
     - the link "Next unreviewed";
     - a 6px progress bar (`role="progressbar"`).
   - **The fit chip:**
     - in the warning tone when over ("3 lines over one page");
     - in the ok tone when it fits ("Fits one page");
     - "Checking fit…" with a spinner while a preview runs.

     It's a `role="status"` region, and clicking it opens the **fit popover** (below).
   - **The score chip:** "Match Score 58 → 81". It opens the Requirement checklist drawer.
   - **"Submit Review"** (primary) and the **⋯** menu (Copy link, Delete Run).
2. **Left rail, 220px, sticky:**
   - **The "Show" filter list** with counts: All changes, Rewordings, Additions, Removals, Unreviewed. Filtering dims the CV marks it excludes and hides their cards.
   - **The Requirements summary:** "4 of 5 must-haves met", a segmented bar, and "Open checklist".
   - **The keyboard legend:** J / K for next and previous; A accept, R reject, E edit; D drops the selected bullet.
3. **The CV page,** centre, flexible: a white card with a raised shadow and 48 to 56px of padding.
   - The CV as a document: name, Headline and contact, then sections with eyebrow headings.
   - **Inline marks:**
     - removed or replaced text: `--fg-3` with a `--del` strikethrough;
     - new text: `--ok`, with a 2px underline at a 3px offset;
     - **the selected Change:** its Item gets an `--accent-soft` background.
   - Clicking a mark selects its Change; selecting a card scrolls its mark into view.
4. **The margin column, 300 to 360px:** one card per Change, in CV order.
   - **The selected card is expanded:**
     - a type badge and "Section · n of 24";
     - the `rationale`;
     - a **"Based on"** box with each piece of Evidence as a quote and its source ("Your CV · Harbor Analytics", or "Your answer about …");
     - the Requirements it targets as outline chips;
     - three full-width buttons: **Accept**, **Reject** and **Edit**. The selected one is filled (green "Accepted" with a check); for a `remove`, only Accept and Reject.
   - **Every other card is collapsed to one line:**
     - a status icon and a title ("Rewording · Harbor Analytics");
     - a truncated preview;
     - a status word ("Accepted", "Rejected", "Edited", "To review").
   - **User drops** appear as cards "Dropped by you · Fieldstone", with Undo.
   - **While the CV is over one page,** a dashed hint card at the end reads: "Still N lines over. Reject an addition, or select any bullet in your CV and press D to drop it."

## Layout, phone and tablet (< 1024px): focus mode
- **Top:** the title, the fit and score chips, and "19 of 24" with the progress bar.
- **One Change per card:**
  - the type badge and section;
  - a plain-language question as the title ("Remove this bullet to fit one page?", "Use this rewording?", "Add this bullet?");
  - the diff;
  - the "Based on" or reason box;
  - "Show it in the CV".
- **Bottom bar:** two 48px buttons for the decision ("Keep it" / "Remove", "Reject" / "Accept"), with "Edit" in the card. Below them: "‹ Previous", "See the whole CV" (the full document view with marks) and "Skip ›". Swiping left or right is an extra, never the only way.
- **Submit** appears in the bottom bar once every Change has been seen; it's always available from the ⋯ menu.

## Decisions
- **Every Change starts accepted.** That matches the view's `fit` ("every Change accepted, no drops"). "Reviewed" counts the Changes the user has selected and decided, or confirmed in bulk. The user can submit at any time. *(Q2)*
- **Edit (revise):**
  - It opens an inline editor in the card: a textarea prefilled with the proposed text, "Save" (⌘ Enter) and "Cancel" (Esc).
  - An edited card shows the user's text with the note: "In your words: goes into the CV exactly as written."
  - **A `reorder`** is edited as a list with "Move up" / "Move down" buttons and drag handles (never drag only).
- **Undo:** every decision and drop can be undone with ⌘Z or from a 6-second toast.
- **Bulk:** "Accept all" and "Reject all" for the current filter live in the filter list's menu, and are undoable.

## Dropping bullets
- **Who can drop:** select a bullet in the CV (click, or Tab to it), then press D or use its "Drop" button. It's droppable when it's an original bullet with no kept Change.
- **Shown by the client** (the server checks again and returns a 400 naming the Item):
  - **A job's last bullet:** Drop is disabled, "Each job keeps at least one bullet."
  - **A bullet with a kept rewording:** "Reject its rewording to drop it."
  - **A bullet whose condense removal is accepted:** no Drop, since it's already removed.
  - **A cited bullet** (Evidence for a met or partially met Requirement): a confirm first, "This bullet is Evidence for 'Go in production'. Dropping it may lower the score."

## Fit popover (from the fit chip)
- **The status:**
  - "Fits one page at size step 3 of 7" (`step + 1`);
  - or "3 lines over one page, even at the smallest size".
- **A 7-segment bar** of the size steps, plus an overflow segment when over.
- **The tip:** "Reject an addition, or drop a bullet."
- **Not fittable** (`fittable: false`): "This CV can't fit one page even with every removal, so you can submit it as it is." Submit is never blocked.
- **The trigger:**
  - Every decision or drop change debounces 600ms, then calls `POST /runs/:id/review/preview` with the full `{ decisions, drops }`.
  - An in-flight request is cancelled (`AbortController`) when a newer one starts.
  - On first load, the view's `fit` is used, with no call.
- **Preview errors:**
  - A 400 `INVALID_REVIEW` marks the named Change's card.
  - A network error shows "Couldn't check the fit" with Retry.

## Requirement checklist drawer (from the score chip or the rail)
- **A right-hand drawer:** Must-have first, then Nice-to-have.
- **Each row:**
  - the Requirement text;
  - before → after verdicts as words (met, partially met, unmet) in the ok, amber or danger tones;
  - a "Confirmed Gap" chip when `confirmedGap`;
  - an expandable `reason` and its Evidence.
- **Hover or focus on a row** highlights the Changes and Items that cite it.
- **The note:** "As proposed. The final score is recalculated from your decisions when you submit."

## Submit
- **The confirm dialog** sums up first: "Accept 15, edit 2, reject 7, drop 2. The Review is final." Buttons: "Submit Review" and "Keep reviewing".
- **A 400 `CV_TOO_LONG`:** close the dialog, set the fit chip from `details.overByLines`, and open the fit popover with "Your choices run past one page. Reject an addition or drop a bullet, then submit again." The focus goes to the popover.
- **A 400 `INVALID_REVIEW`:** select the named Change, show the message on its card, and focus it.
- **A 202:** go to the progress view ("Applying your Review…") until `completed`.

## Accessibility
- **Each Change card** is a `group` labelled "Change 5 of 24, rewording, Experience". The inline marks have text equivalents ("Removed: …, Added: …").
- **Shortcuts** work only outside text fields, and can be turned off (MASTER).
- **Focus:** the card and its mark move together, and the focus stays on the card.

## Settled in the grilling (2026-10-27)
- **Q1, the original CV:** the `awaiting_review` and `completed` views gain `originalCv` (slice 07a). The client renders the original and lays the Changes over it.
- **Q2, starting decisions:** every Change starts accepted, "reviewed" counts the ones looked at, and Submit is never blocked.
- **Q3, "may change":** the checklist marks a Requirement "may change" when, under the current decisions:
  - a Change that lists it is rejected or revised;
  - its Evidence cites an Item an undone Change touched;
  - its Evidence cites a dropped bullet.

  These are the same three sets `final_rejudge` re-judges, all computed in the browser.
- **Q4, page thumbnail:** none in v1.
- **The drop rules** move to `@resume-ai/shared` (slice 07a), so the client's "can I drop this?" and the server's check are one code path.
