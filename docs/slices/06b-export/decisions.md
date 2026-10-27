# Slice 6b: export, decisions

Settled in a grilling session (2026-10-27). All decisions are owner-approved. Spec: #48. Terms follow `CONTEXT.md`, updated in the same session (**Headline**, **Tailored CV**).

## Scope
- 6b exports the Tailored CV as DOCX and PDF on one page where the layout can shrink to fit. Making every CV fit (shortening and dropping bullets) is **6c** (`06c-one-page`), outlined at the end.
- **The Tailored CV is always one page** (owner's rule). 6b holds it for the PDF by shrinking the layout; 6c guarantees the content fits.

## Rendering on demand (ADR 0008)
- **Nothing exported is stored.** Each download reads the `completed` CV from the checkpoint, builds the file in memory and streams it. No `export` node, no files on disk, nothing for `DELETE` or the sweep to remove. Rejected: writing both files when the Run completes (a second copy of the CV to delete, a partial-failure path, and the server tied to one disk) for a build that takes milliseconds and no model call.
- `runs.export_path` is unused; a ticket drops it.

## Routes
- `GET /runs/:id/cv.docx` and `GET /runs/:id/cv.pdf`, for a `completed` Run only.
  - 404 for an unknown or expired Run, 409 `RUN_NOT_COMPLETED` for any other status, 409 `CV_TOO_LONG` for a CV that does not fit one page at the smallest size (until 6c).
  - Sent as attachments with the right content type, filenames `tailored-cv.docx` and `tailored-cv.pdf` (no personal data in a filename), `Cache-Control: no-store`.
- The `completed` view's `download` holds `/runs/:id/cv.docx` and `/runs/:id/cv.pdf`; it stays absent for other statuses. Both links are present even for a CV too long to export; the route says why.

## Template
The owner's own CV layout, rebuilt in code. The owner's file never enters the repo; only its layout is described here.
- **Header:** the name (large, bold), the Headline under it (bold, smaller), then one contact line each as "**Label:** value": Phone, Email, Location, then each link under its own label (a link without a label shows the URL alone). Empty fields are skipped.
- **Section headings:** uppercase italic text on a full-width light-gray bar (rounded in the PDF; square paragraph shading in the DOCX, which Word cannot round).
- **Fixed order and headings:** Professional Summary, Professional Experience, Projects, Education, Technical Skills, Certifications, then each additional section under its own title. An empty section is left out. The candidate's own wording of a typed heading is not kept (the structure does not store it).
- **Experience:** "**Title — Company**" left, dates right in italics, then justified bullets. The location, when present, follows the company.
- **Projects:** "**Name**" left, the URL right in italics, then the dates (if any) and bullets. No new project fields: a tagline stays in the name and a tech-stack line stays a bullet, as extraction gives them.
- **Education:** "**Institution — Degree, Field**" left, dates right, then bullets. **Certifications:** "Name — Issuer" left, date right. **Skills and additional sections:** one line per Item, no bullets.
- **Dates:** "Jun 2017 – Feb 2020", "2024 – Present", a bare year as given; an open start shows the end alone.
- **Page:** A4, justified bullets.
- **Fonts:** Poppins (name and headings) and Figtree (body), bundled in `backend/assets/fonts/` with their SIL Open Font License files and embedded in both formats.
- **Details settled on the first sample PDF (owner, 2026-10-27):** a project's dates sit on their own italic line under its name (the URL holds the right side); a job's location follows the company in regular weight ("**Title — Company**, Location"); a URL inside a bullet may break at "/" or "-" (contact lines and right-side URLs never break; no custom line breaking); headings are slightly letter-spaced on a `#e4e4e7` bar.
- **Latin script only in v1.** A character the fonts lack renders blank or as a box; a Hebrew CV exports badly. Right-to-left is its own slice if needed.

## One page in 6b: shrink to fit
- **The PDF is the ruler.** `measureFit` lays the CV out with PDFKit and counts pages. At the normal size the body is 10.5pt with 1.8 cm margins; it steps down 0.25pt at a time (name, headings, spacing and margins scale with it) to a floor of 9pt and 1.2 cm margins. The first step that fits one page is used.
- **The DOCX** uses the same sizes one step smaller than the PDF's fitting step (unless the PDF is already at the floor), as a safety margin for Word's and Google Docs' line breaking. Only the PDF is guaranteed one page.
- A CV that does not fit at the floor gets 409 `CV_TOO_LONG` from both routes. 6c makes this unreachable for new Runs.

## Headline
- New nullable `contact.headline`: the line under the name that says what the candidate is ("Software engineer"). Extracted verbatim like every field, null when the CV has none.
- Never a Change target and never removed: like titles and companies, it states who the candidate is. It is part of the contact Item's text for Evidence.
- Old checkpoints without it need no migration (ADR 0003): a missing headline reads as null.

## Code
- New layer `backend/src/export/`: the layout (CV → page blocks), the PDF and DOCX renderers, and `measureFit`. No model, no database, no Express; it imports only shared types. Services call it for downloads; in 6c `tailoring/` calls `measureFit`. `CLAUDE.md` and `architecture.test.ts` gain the layer.
- Libraries: `docx` (paragraph shading, right tab stops for dates, embedded fonts, `Packer.toBuffer`) and PDFKit (registered TTF fonts, wrapping and justification, automatic page breaks, rounded rectangles). Rejected: `pdf-lib` (no text wrapping), LibreOffice or headless Chrome (system installs in every Docker and CI setup). Both move to `dependencies`.

## Tests and proof
- Tests use the made-up fixture CV only (never `local-cvs/`). The PDF is read back with `unpdf` (page count, text order); the DOCX with `mammoth` (text order). A long made-up CV proves shrink-to-fit and `CV_TOO_LONG`.
- **Owner sign-off before the PR:** sample PDF and DOCX of the fixture CV, generated into the scratchpad (not committed), approved by the owner.
  - **Approved 2026-10-27:** the PDF at step 0 and the DOCX at step 1 (10pt body: Word sizes are whole half-points, so the DOCX rounds sizes down and is never larger than its step). The DOCX's heading bars are square without the PDF's vertical padding; it embeds the fonts (about 400 KB). Word on the web and Google Docs may substitute the fonts.

## Tickets
| Ticket | Scope | Depends on |
|---|---|---|
| T1 (#49) | `contact.headline`: shared schema, extraction, verbatim check, never a Change target | — |
| T2 (#50) | `export/` layer: layout, PDF renderer, `measureFit` and shrink-to-fit, fonts, architecture rule | T1 |
| T3 (#51) | DOCX renderer from the same layout | T2 |
| T4 (#52) | Download routes, `download` links, 409s, drop `runs.export_path` | T3 |

## Slice 6c outline: one page for every CV
Agreed in the same session; the details (the condense round's limit, its place relative to the exit router, its status and steps in the view) get a short grilling at the start of 6c.
- **Nothing but bullets is ever removed.** Jobs, education, projects, certifications, every skills line, additional sections and the summary always stay; each job keeps at least one bullet. Bullets and the summary may be reworded shorter.
- **Page-aware tailoring:** the tailor is told about the one-page limit and to prefer `replace` over `add`; a stage-1 check rejects an `add` that pushes a fitting CV past one page at the floor. A CV already too long is not blocked.
- **Condense round** after tailoring, when the CV with every Change accepted does not fit: the model first proposes shorter rewordings of bullets and the summary (`replace`, claim-checked), then, if still too long, drops bullets with a new `remove` Change (bullets only), measured after each step, up to a small limit. A bullet a Requirement cites as Evidence (met or partially met) is never dropped.
- **Review:** every condense Change is decided like any other. The user may also drop bullets under the same rules. A Review whose result does not fit is a 400; `POST /runs/:id/review/preview` (no state change) returns the fit, the size used and how much is over, and the `awaiting_review` view shows the fit with every Change accepted.
- **Score:** every dropped bullet re-judges the Requirements whose Evidence cites it (the ADR 0003 partial re-judge rule).
- **ADR 0003 amended:** a `remove` Change applies only to a bullet, only to fit one page, never to Evidence a Requirement cites; nothing else is ever removed.

## Proof
One real Run (2026-10-27, `gemini-3.5-flash-lite`, the fixture CV `backend/test/fixtures/cv.docx` and a made-up job description), through `scripts/proof-run.sh --review accept-all` to `completed`, score 42 → 64, 4 Changes accepted.
- Before `completed` (at `awaiting_answers`) both routes answered 409 `RUN_NOT_COMPLETED`, and the view had no `download`.
- At `completed` the view held both links. `cv.pdf` and `cv.docx` answered 200 with the right `Content-Type`, `Content-Disposition: attachment; filename="tailored-cv.<ext>"` and `Cache-Control: no-store` (27 KB and 412 KB).
- The PDF read back with `unpdf` is one page. The PDF and DOCX texts (unpdf, mammoth) hold the same sections in the same fixed order, with the accepted Changes applied.
- Found on the way, not export bugs: round 3 hit a provider 429, so the Run exited with `exitReason: error` after two rounds (existing behaviour). The accepted summary `replace` began with the prompt's item tag ("[summary] Backend developer …"): the tailor copied it from the rendered CV and nothing strips or rejects it, so it reached the exported file. **Fixed in this slice (owner's call):** a new stage-1 rule rejects a `replace` or `add` whose text contains an Item ID tag (`[summary]`, `[exp1.b2]`, `[ue1]`, …; ordinary brackets pass), so the tailor retries. A user's revised text in Review goes through the same check.
