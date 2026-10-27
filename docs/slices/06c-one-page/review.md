# Slice 6c: one page for every CV, review

`/code-review` over `master...feat/slice-6c-one-page` (2026-10-27), with two read-only reviewers, Standards and Spec, run in parallel. The Spec reviewer checked the slice's guarantees against the code and found none broken:
- every path into Review condenses;
- the model never removes a cited, added or last bullet;
- the user's drop rules hold;
- `fittable` and the 400 before the claim are in place;
- the `fit` step is right;
- `final_rejudge` covers the union;
- condensing never changes `exitReason` or fails the Run;
- the fixture is invented.

Decisions below are the owner's.

## Standards
| ID | Finding | Decision |
|---|---|---|
| S1 | Parameters every real caller passes are optional (CODING_STANDARDS.md, "required when every caller passes it"): `drops` (`runReview`, `GraphRunner.review`, `reviewProblem`), `ValidateInput.coverage`, `TailorInput.fit`, `CondenseInput.userEvidence`, `toRunView`'s `fit`. | Fixed. `Stage1Options.coverage` stays optional: Review's stage-1 call sees only revised Changes, never a `remove`, and the `noCoverage` rejection stays as the safety net. |
| S2 | Duplicated code: the jobs, projects and education walk appears in five files, and the original-bullet-ID set is built three times. | Fix: `bulletParents` and `originalBulletIds` in `cvItems.ts`. |
| S3 | Duplicated code: the Items a Change touched, and the Requirements citing them (`condense.ts`, `runGraph.ts` `condense_rejudge`, `roundCoverage.ts`). | Fix: `touchedItemIds` and `requirementsCiting` in `roundCoverage.ts`. |
| S4 | A stale doc reference (`reviewFitOrThrow`), and the unclear third parameter of `fitOfChanges`. | Fix. |
| S5 | `tailoring/` imports `export/` by two paths. | Fix: one path. |
| S6 | Three types for one fit result (`FitResult`, `TailorFit`, `ReviewFit`). | Follow-up. |
| S7 | `condenseReword` and `condenseDrop` share a skeleton. | Follow-up. |
| S8 | `previewReview` repeats the pause check of `resumeFromPause`. | Follow-up. |
| S9 | `ApiError`'s status override makes `CV_TOO_LONG` 400 on submit and 409 on download. | Accepted: one code for the frontend; documented in decisions.md. |
| S10 | `stage1Checks` keeps gaining optional arguments. | Partly fixed by S1; otherwise accepted. |

## Spec
| ID | Finding | Decision |
|---|---|---|
| P1 | No record of the proof Run. | Next step before the PR. |
| P2 | The view's `step` counts from 0 and the tailor's fit line from 1. | Fix: state it in the `ReviewFitSchema` comment. |
| P3 | The page check on `add`s can reject them all and the draft is still over (the round's `replace`s lengthened it). | Accepted: Condensing catches it after tailoring, and the tailor sees the rejections. Recorded in decisions.md. |
| P4 | The reword step leaves out tailor-added bullets. | Accepted (no Evidence to claim-check them against). Recorded. |
| P5 | The minimal CV keeps `reorder`s. | Accepted (harmless). Recorded. |
| P6 | Extra span attributes (`condense.valid`, `condense.rejected`, `validate.rejected_past_page`). | Accepted. |
| P7 | The `awaiting_review` view measures the CV on every read (up to 14 PDF renders). | Follow-up, with the render cost below. |

## Follow-ups
- **Fewer renders:** `measureFit` tries the 7 size steps one by one, and a binary search would need about 3 renders. Most route tests could use a stub instead of real PDFs (the `reviewFit` route test takes 21 minutes in a flake check). Each tailoring round measures the draft twice.
- S6, S7, S8 and P7.
