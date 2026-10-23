# 02 PDF reading order

**Goal:** PDF parsing returns text in visual reading order, so two-column CVs no longer come out jumbled (sections out of order, dates glued to the next line, headings far from their content).

**Waits for:** nothing. Runs in parallel with 01.

**Plan sections:** "`backend/src/parsing/`" and the `parsing/*` rows of "Tests" in `../plan.md`. Background: "Parsing: PDF reading order" in `../decisions.md`.

## What to build

1. **`backend/src/parsing/pdfLayout.ts`**, a pure function with no `unpdf` import, for example `layoutPage(items: TextItem[], pageWidth: number): string`, where `TextItem` is `{ str, x, y, width, height }`:
   - Group items into lines by `y`, with a tolerance for baseline jitter (a fraction of the median item height).
   - Sort each line by `x`. Join neighbours with nothing or a single space as the gap suggests, and insert a clear separator (two spaces) where the gap is much wider than a space, so `2021 - Present` stays apart from `Senior Developer`.
   - Find a column gutter: an x band that no line's items cross over most of the page height. If one exists, emit the left column top to bottom, then the right. Otherwise emit lines top to bottom (single-column fallback). Tables and three columns are out of scope.
   - Thresholds are named constants at the top of the file with a comment on what each controls.
2. **`parsePdf` in `parsing/parseCv.ts`:** get positioned items from `unpdf` (`extractTextItems`, or `getDocumentProxy` plus `page.getTextContent()` if that is what this `unpdf` version offers; check the installed version's API, and use Context7 for current `unpdf` docs). Keep the page-count check before extraction, `maxImageSize`, the scanned-PDF check (on visible characters per page) and the page join with blank lines. Only `parsePdf` and its helpers change. Ticket 01 renames three `ApiError` codes in this file in parallel; don't touch those lines.
3. **Fixtures** (`backend/test/make-fixtures.ts`, then `pnpm --filter backend fixtures`):
   - `cv-two-column.pdf`: a fictional person. A left sidebar with name, contact and skills; a right main column with summary, two jobs (each with a date range drawn at the right edge of the title line, like real CVs), and education. Draw the content in an order that differs from the visual order (for example the main column first, and dates after all titles), so the test proves the layout code reorders.
   - `cv-encrypted.pdf`: a password-protected PDF. If `pdf-lib` cannot encrypt, write a minimal encrypted PDF another way, or commit one generated with a tool, and say how in a comment.
4. **Tests** (`backend/test/parsing/`):
   - `pdfLayout.test.ts`, with no PDF involved: lines grouped despite jitter; a wide gap becomes a separator; a two-column page reads left column then right; a single-column page reads top to bottom; an empty page gives `""`.
   - `parseCv.test.ts` additions: `cv-two-column.pdf` comes out with the name before the summary, each job's date range on the same line as its title and not glued to it, and the sidebar block before or after the main block, never interleaved line by line. `cv-encrypted.pdf` is rejected (code `UNREADABLE_FILE` once 01 is merged; until then assert the rejection without pinning the code, and pin it after the merge). A parse timeout (a tiny `parseTimeoutMs`) is rejected the same way.
   - Existing parser tests keep passing.

## Acceptance
- `pnpm typecheck` passes; `pnpm --filter backend test test/parsing` passes during the wave.
- The two-column fixture's extracted text is printed once in the test output or in a comment, so a reviewer can see the order.
- No real CV in git.
