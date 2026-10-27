# Slice 6c: one page for every CV, decisions

Settled in a grilling session (2026-10-27), building on the outline agreed in 6b (`docs/slices/06b-export/decisions.md`, "Slice 6c outline"). All decisions are owner-approved. Spec: #54. Terms follow `CONTEXT.md`, updated in the same session (**Condensing**, **Change**, **Tailored CV**). ADR 0003 is amended: `remove` only to fit one page.

## Scope
- Every Tailored CV fits one A4 page. 6b shrinks the layout down to the floor (9pt, 1.2 cm); 6c makes the content fit when the floor is not enough.
- **Nothing but bullets is ever removed.** Jobs, education, projects, certifications, every skills line, additional sections, the summary and the Headline always stay. Each job keeps at least one bullet. Bullets and the summary may be reworded shorter.

## The `remove` Change
- Shape: `{ op: "remove", targetItemId, before, rationale }` with no Evidence and no Requirements. It skips the claim check (it adds no text).
- **The model's drop rules** (computed in code as `removableBullets`, and enforced by stage 1):
  - the bullet is original, never one the tailor added (the user rejects an `add` in Review instead);
  - it isn't cited as Evidence by a met or partially met Requirement;
  - it isn't its job's last remaining bullet.
- There's no `origin` field: a `remove` speaks for itself, and a shortened `replace` says so in its rationale.
- One Change per Item still holds. A condense rewording of a bullet the tailor already changed merges into that Change, so the user sees original → shortened text, and rejecting it brings back the original. The user can revise it to get the longer tailored text back.

## Page-aware tailoring
- The tailor prompt says the Tailored CV must fit one page and to prefer `replace` over `add`. It carries a one-line fit status of the current draft: "fits at size step N of 7" or "already over by K lines".
- Stage 1 checks fit once per round, after the other checks. **Only if the draft fitted before the round** and the draft with all the round's valid Changes doesn't fit at the floor, it rejects the round's `add`s, last proposed first, until the CV fits ("would push the CV past one page"). A draft that was already over blocks no `add`.

## Condensing
- **Where it sits:** a phase in front of `review` on all three paths into it (`route`, `assess_coverage`, `collect_answers`). A Run that skips tailoring can still have an original CV too long for one page. Condensing measures first and does nothing when the CV with every Change accepted fits.
- **One-way:** it runs after the exit router has decided, never loops back to tailoring, and leaves `exitReason` and `iterations` unchanged.
- **The limit:**
  1. One reword step: shorter `replace`s of bullets and the summary, listed longest first. Each must have fewer characters than the Item's current text, and each is claim-checked through `validateChanges`.
  2. While still over, up to two drop steps. Each is told `overByLines` and offered only the `removableBullets` IDs, and the model picks the least relevant to the Requirements.

  `measureFit` runs after each step, and condensing stops as soon as the CV fits.
- **Kept regardless of score:** every valid condense Change is kept, even when the re-judge lowers the score. Fitting the page wins, and the user can reject any of them in Review.
- **Re-judge:** once condensing ends, one re-judge covers the Requirements whose Evidence cites any Item it reworded or dropped (the ADR 0003 partial re-judge rule). The `awaiting_review` score already reflects condensing.
- **Failure:** a model error (a 429 included) stops condensing without failing the Run. It keeps the valid Changes so far and goes to Review with the fit as it stands, the same stance as `final_rejudge`.
- **Graph:** one node per step, so a server stop resumes from the last finished step.
- **Model and tracing:** the same `LlmClient` as the tailor. Spans `condense.reword` and `condense.drop`, with attributes `condense.fit_after` (`overByLines`, 0 when it fits) and `condense.failed`.
- **View:** the status stays `tailoring` (no new status in `runs` or the view union). A new step key, `fit`, sits between `tailor` and `review`, and goes straight to `done` when nothing needed condensing.

## Review
- **Condense Changes** are decided like any other. A `remove` can be accepted or rejected, not revised (400).
- **User drops:** the Review body becomes `{ decisions, drops: ItemId[] }`. Each drop becomes a `remove` Change with status `revised` (the user's own, trusted). The user may drop a **cited** bullet: the never-drop-cited rule binds the model, not the user. Only original bullets can be dropped, and never a job's last remaining bullet. A drop that breaks a rule is a 400 naming the Item.
- **Preview:** `POST /runs/:id/review/preview` takes the Review body and validates it the same way, but changes nothing. It returns `{ fits: true, step, fittable } | { fits: false, overByLines, fittable }`, with `overByLines = ceil(overBy / 14)` (about 14 points per line). It's allowed only at `awaiting_review` (409 otherwise).
- **The fit in the view:** `awaiting_review` gains `fit` in the preview's shape, computed on read with every Change accepted and no drops (not stored). `completed` doesn't get it.
- **Fittable:** the minimal CV is every `add` rejected, every other Change accepted, and every droppable bullet dropped (each job keeps one). If it fits at the floor, the Run is `fittable`, and a Review whose result is too long is a 400 `CV_TOO_LONG` with `overByLines`. If even the minimal CV doesn't fit, the Review is accepted as submitted, and the download keeps 6b's 409 `CV_TOO_LONG` as the last resort.
- **`final_rejudge`** re-judges the union of three sets of Requirements: those listed by rejected or revised Changes, those whose Evidence cites an Item an undone Change touched, and those whose Evidence cites a bullet the user dropped.

## Domain language
- **Condensing** joins `CONTEXT.md`. "Condense round" and "trimming" are avoided, since "round" already means a tailoring round.
- **Change** gains the `remove` op, and **Tailored CV** points to Condensing.

## Tests and proof
- A synthetic, made-up fixture CV that runs to about 1.5 pages at the smallest size. No `local-cvs` text.
- **Proof:** one real Run through `scripts/proof-run.sh` on that CV. It should:
  - reach `awaiting_review` with the `fit` step done and condense Changes, including at least one `remove`;
  - get a preview that reports over when one condense `remove` is rejected;
  - accept a Review with a user drop that fits;
  - produce a downloaded PDF that reads back as one page.

## Settled during implementation
- **Fit line numbering (#56):** "size step N of M" counts from 1 (N is `step + 1`, M is `FLOOR_STEP + 1`, so 7).
- **The page check's cost (#56):** each tailoring round measures the draft twice, once for the prompt and once for the `add` check, and each measure renders up to 7 PDFs. Accepted for now; a follow-up if rounds get slow.
- **The overflow measure was wrong in 6b (#57, found by the Condensing agent).** `renderPdf` reported the total content height, not the height past the first page, so `overBy` and `overByLines` were about one page too high (the long fixture went from 85 lines over to 26). It's fixed in `export/pdfRenderer.ts`, with a test that removing `ceil(overflow / item height)` items fits.
- **Condensing in the graph (#57):**
  - Nodes `condense_measure`, `condense_reword`, `condense_drop` (it loops, at most twice) and `condense_rejudge`.
  - `condense_measure` writes no status and makes no model call. A CV that fits goes straight to `review`, so it never flashes `tailoring`. On the skip-tailoring path, only a CV that's too long moves to `tailoring`.
  - The graph reaches `fitOf` only through `tailoring/condense.ts` (`measureCondense`).
- **Condense Change IDs:** `cd1.cN` for the reword, `cd2.cN` and `cd3.cN` for the drops. A reword's Evidence is the Item itself plus whatever an earlier `replace` of it cited, and its rationale is fixed ("Shortened to fit one page.").
- **What a failure leaves (#57):**
  - A failed re-judge after condensing **keeps** the earlier verdicts rather than reverting them, because the claim check already vouched for each rewording.
  - A failure measuring the CV skips condensing.
  - Condense rejections aren't stored in `rejections`, because the tailor never runs again.
- **The `fit` step in the view (#57):** `pending` until condensing starts, `running` while it runs (the status is `tailoring`), and `done` once condensing has finished or wasn't needed. An Interrupted Run cut off during condensing shows it `failed`.

## Tickets
| Ticket | Scope | Depends on |
|---|---|---|
| T1 (#55) | The `remove` Change, `removableBullets`, stage-1 `remove` rules, the fit helper | — |
| T2 (#56) | Page-aware tailoring: fit line in the prompt, stage-1 `add` check | T1 |
| T3 (#57) | Condensing: graph phase, reword and drop steps, re-judge, failure, spans, `fit` step, synthetic long fixture | T1 |
| T4 (#58) | Review fit: `drops`, preview, `fit` and `fittable` in the view, 400 `CV_TOO_LONG`, wider `final_rejudge` | T1, T3 |
