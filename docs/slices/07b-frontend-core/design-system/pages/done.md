# Page: Done (`/runs/:id`, status `completed`)

Direction B. Mockup board: "B · Done".

## Purpose
Hand over the Tailored CV and show the outcome honestly, including when the Review lowered the score.

## Layout
- One centred column, 640px max, text centred.
- A 56px green check circle, then **"Your tailored CV is ready"**, with "Senior Backend Engineer at Northwind Labs · one page" below it.
- **The score:**
  - before (24px, `--fg-3`) → the final after (64px, 700), with the delta chip;
  - the caption: "Match Score, before and after".
  - **When the delta is ≤ 0,** a neutral chip instead of a green one, plus the line "Your Review kept fewer of the Changes, so the score moved less. The CV still says only what's true."
- **Two full-width buttons side by side:** "Download PDF" (primary) and "Download Word" (secondary). They are links to `download.pdf` and `download.docx` with `download` attributes, and show a short busy state.
  - **A 409 `CV_TOO_LONG`:** "This CV can't fit on one page with your choices." / "Download it anyway as Word, or start a new Run with a shorter CV."
- **Three stat tiles,** counted from the kept Changes and `requirements`: "rewordings kept", "bullets added" and "must-haves met".
- **Links:**
  - "See what changed" opens the CV in read-only suggesting mode, kept Changes only;
  - "Tailor for another job" goes to `/`;
  - "Delete this Run now" (danger) confirms first.
- **Footnote:** "Deleted automatically on 3 Nov." (from `expiresAt`).
