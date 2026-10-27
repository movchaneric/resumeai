# Slice 6b: review

Two-axis review (`mattpocock-skills:code-review`) of `feat/slice-6b-export` against `master`, 2026-10-27. Spec: #48 with tickets #49–#52 and `decisions.md`. The owner accepted every recommendation.

## Standards
No breaches of `CODING_STANDARDS.md` or `CLAUDE.md`. Smells (judgement calls):

| # | Finding | Decision |
|---|---|---|
| S1 | `Run` in `export/layout.ts` (a styled text piece) clashes with **Run** in `CONTEXT.md` | Fix: rename to `TextSpan` |
| S2 | `exportCv` copies `getRunView`'s Run lookup and 404 | Fix: one shared lookup |
| S3 | A missing headline becomes null in two places (`CvSchema` default, `toSnapshot`) | Keep: one serves parsed views, the other the raw checkpoint |
| S4 | Gray bar, text colour and line-height factor defined in both renderers | Fix: one definition in `export/` |
| S5 | `exportCv` lays out and renders the PDF again after `measureFit` already did | Fix: `measureFit` returns the blocks and the winning render |
| S6 | Unused barrel exports in `export/index.ts`, unused exported constants in `sizes.ts` | Fix: trim |
| S7 | The DOCX `text()` helper makes callers pass a dummy `text: ""` | Fix: a separate style type |
| S8 | `Sizes.step` repeats `Fit.step` | Keep |
| S9 | Both renderers switch on `block.kind` | Keep: two formats over one closed union |
| S10 | `ExportFormat` declared in `services/runs.ts` | Fix: move beside `export/` |

## Spec
Nothing missing, no scope creep, nothing wrong.

| # | Finding | Decision |
|---|---|---|
| P1 | Some lengths do not scale with the step (PDF heading bar padding, inset and radius, right-side gap, letter-spacing; DOCX letter-spacing), though "name, headings, spacing and margins scale with it" | Fix: derive them from `Sizes` |
| P2 | The test "links present even when the CV is too long" uses a normal CV | Fix: use a too-long CV |
| P3 | Graph nodes resuming an older Run see `headline` as undefined | Keep: every reader treats undefined and null alike (checked in #49) |
| P4 | A `completed` Run whose checkpoint has no CV answers 404 | Keep; recorded here |
