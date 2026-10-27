# Handoff: slice 6b done, next is slice 6c

## Where things stand
- **Downloads.** `GET /runs/:id/cv.pdf` and `GET /runs/:id/cv.docx` build the `completed` Tailored CV in memory on each request and send it as an attachment (`tailored-cv.pdf` / `tailored-cv.docx`, `Cache-Control: no-store`). Nothing is stored (ADR 0008); `runs.export_path` is dropped.
  - Errors: 404 for an unknown or expired Run, 409 `RUN_NOT_COMPLETED` for any other status, 409 `CV_TOO_LONG` when the CV does not fit one page at the smallest size. A `completed` Run with no CV in its checkpoint is a 404 (review P4).
  - The `completed` view's `download` holds both links, even for a CV too long to export.
- **`backend/src/export/`** (new layer: no model, DB or Express; imports only shared types, `pdfkit`, `docx` and node built-ins):
  - `layoutCv` turns the CV into blocks in the owner's template (decisions.md, "Template"); both renderers draw the same blocks.
  - `sizesForStep` is the size table: body 10.5pt to 9pt in 0.25pt steps, margins 1.8 to 1.2 cm, every other length scaled with the body.
  - `measureFit(cv)` renders the PDF at each step and returns the first that fits one A4 page, with its blocks and PDF, or how far over it is at the floor. In 6c `tailoring/` will call it.
  - The DOCX uses `docxSizes(step)`, one step smaller than the PDF unless at the floor. Word sizes are whole half-points, so it rounds down.
  - Fonts: Poppins and Figtree (SIL OFL) in `backend/assets/fonts/`, embedded in both formats. Word on the web and Google Docs may substitute them.
- **Headline.** `contact.headline` (nullable) is extracted verbatim and verbatim-checked, and is part of the contact Item's Evidence text. It is never a Change target. An older checkpoint reads it as null in the snapshot.
- **Item-tag rule** (found by the proof Run). Stage 1 rejects a `replace` or `add` whose text contains an Item ID tag like `[summary]`. A user's revised text in Review goes through the same check.
- **Docs:** `decisions.md` (decisions, the owner's layout calls, the sign-off, the proof), `review.md` (findings and the owner's decisions). ADR 0008. Spec #48, tickets #49 to #52.
- **Tests:** 706 backend, 37 shared; `pnpm typecheck` passes. The PDF is read back with `unpdf` and the DOCX with `mammoth`.

## Running it locally
- `scripts/proof-run.sh --review accept-all <cv> <jd> [answers.json]`, then `curl -OJ localhost:3000/runs/<id>/cv.pdf` (and `cv.docx`).
- Write the answers file for the CV you send: answers naming another CV's companies end up in its bullets.
- With `gemini-3.5-flash-lite` a round can hit a provider 429. The Run then ends `completed` with `exitReason: error` on the rounds it had.
- A sample of the fixture CV for a visual check: render `fixtureCv()` from `backend/test/export/exportCv.ts` with a throwaway script outside the repo. Never commit samples.

## Follow-ups
- **Accepted, not changed** (review.md): S3, S8, S9, P3, P4.
- A URL inside a bullet may break at "/" or "-" (owner's call).
- **Owner to-dos still open:** `scripts/worktree.sh prune-dbs --yes`; close #6 to #17 and #19; delete old branches (`feat/shared-schemas`, `feat/slice-1/2/3-*`, local `feat/slice-5b-live-updates`, `chore/retro-5b`) and the remote `feat/slice-6a-review-cleanup`; check whether the GitHub handle belongs in `local-cvs/.private-names`.

## Next
- **Slice 6c** (`06c-one-page`): every Tailored CV fits one page. The outline is at the end of `decisions.md` (page-aware tailoring, condense round, a bullet-only `remove` Change, fit at Review, ADR 0003 amended). Start with a short grilling (`mattpocock-skills:grilling`) of its open details: the condense round's limit, its place relative to the exit router, and its status and steps in the view.
- Then slice 7 (frontend). It **must start with a Claude Design pass**.
