# Handoff: slice 6c done, next is slice 7

## Where things stand
Slice 6c merged in PR #59 (spec #54, tickets #55 to #58). **Every Tailored CV fits one A4 page.**
- **The `remove` Change** applies to bullets only, and only to fit the page (ADR 0003, amended).
  - The model never removes a bullet that a met or partially met Requirement cites, a bullet the tailor added, or a job's last original bullet. `removableBullets` in `tailoring/removable.ts` computes the allowed list, and stage 1 checks each remove again.
  - Nothing else is ever removed.
- **Page-aware tailoring:** the tailor prompt carries the draft's fit ("size step N of 7" or "over by K lines"). `validateChanges` rejects the round's `add`s, last first, when they push a CV that fitted past one page.
- **Condensing** (`tailoring/condense.ts`) sits on every path into `review`:
  - The nodes are `condense_measure`, then `condense_reword` (one step), then `condense_drop` (up to two), then `condense_rejudge`.
  - A CV that fits passes straight through, with no model call and no status write.
  - Condensing never fails the Run, never loops back to tailoring and never changes `exitReason`.
  - A new `fit` step appears in the view, with the status staying `tailoring` while it runs.
- **Review:**
  - The body is `{ decisions, drops }`. A drop becomes a `remove` Change with an ID `ud.cN` and status `revised`. Cited bullets can be dropped by the user, but never a job's last bullet.
  - `POST /runs/:id/review/preview` returns the fit without changing anything.
  - The `awaiting_review` view has `fit: { fits, step | overByLines, fittable }`, where `step` counts from 0.
  - A submit that's too long gets 400 `CV_TOO_LONG` with `overByLines` when the Run is `fittable`, and is accepted when it isn't.
  - `final_rejudge` also re-judges the Requirements citing undone or dropped Items.
- **Fixed from 6b:** `renderPdf`'s overflow reported the total content height, so "lines over" was about a page too high.
- **Docs:**
  - `decisions.md`: the design, "Settled during implementation", and the Proof;
  - `review.md`: findings and the owner's decisions;
  - `retrospective.md`;
  - ADR 0003, and `CONTEXT.md` (**Condensing**).
- **Tests:** 821 backend and 45 shared tests pass, and `pnpm typecheck` is clean.

## Running it locally
- Start `pnpm dev` from a shell with no test overrides. A shell with `RUN_TTL_DAYS` or `SWEEP_INTERVAL_MS` exported deletes Runs within a minute. Check the `listening` line in `backend/logs/dev.log` and `env | grep -E 'TTL|SWEEP'`.
- Proof flow:
  1. `scripts/proof-run.sh --watch <cv> <jd>`, then `--resume <id> answers.json`.
  2. At `awaiting_review`, `POST /runs/<id>/review/preview` with `{ decisions, drops }`.
  3. Then `POST /runs/<id>/review`.
- A long test CV: render `longCv()` from `backend/test/fixtures/longCv.ts` to a DOCX with a throwaway script outside the repo (`layoutCv`, `renderDocx` at `sizesForStep(0)`). It's 26 lines over at the floor. Never commit the output.

## Follow-ups (`review.md`)
- **PDF render cost:**
  - `measureFit` tries the size steps one by one (up to 7 renders); a binary search would need about 3.
  - The `awaiting_review` view and the preview measure on every read (up to 14 renders when over).
  - Each tailoring round measures twice.
  - The `reviewFit` route test takes about 21 minutes in a flake check; stub the measure in route tests that don't need real PDFs.

  Worth doing before or early in slice 7, since the frontend reads the view and the preview often.
- **S6:** three fit types (`FitResult`, `TailorFit`, `ReviewFit`).
- **S7:** the reword and drop steps share a skeleton.
- **S8:** `previewReview` repeats the pause check.
- **Still open from 6b:** S3, S8, S9, P3 and P4 in `06b-export/review.md`. The owner to-dos listed in `06b-export/handoff.md` are unchanged.

## Next
- **Slice 7: the frontend.** It **must start with a Claude Design pass** (owner: very important) before any frontend code, then a grilling and the spec.
- The screens:
  - **Upload.**
  - **Questions.**
  - **Live progress:** the steps, including `fit`.
  - **Review:** accept, reject or revise each Change; drop bullets; see the fit and preview it live; the `CV_TOO_LONG` message.
  - **Download.**
