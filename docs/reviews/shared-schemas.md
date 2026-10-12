# Review feedback: `feat/shared-schemas`

Review of `git diff 908c90a` (shared zod schemas in `shared/src`) against `CONTEXT.md` and ADRs 0001–0003. Please address the items below, in priority order. Where an item says "decide", pick one option and note the choice in `CONTEXT.md` or an ADR if it is a domain decision.

## Must fix

1. **A `revised` Change loses the user's text** (`change.ts`). `status` has `revised`, but no field stores the revised content. CONTEXT.md: "The user can accept, reject, or revise each Change". Add a field (e.g. `revisedText` or equivalent per Change kind) so the edit is recoverable.
2. **`origin: "agent" | "user"` conflicts with the domain language** (`change.ts`). ADR-0001: tailoring is a workflow, not an agent. CONTEXT.md reserves "edit" for the user's revision of a Change. Rename `"agent"` (e.g. `"tailor"`), or drop `origin` and rely on `status: "revised"`.
3. **Container IDs for `add` / `reorder`** (`cv.ts`, `change.ts`). Skills, summary and additional sections have no ID in `CvSchema`, but `add`/`reorder` need a `parentId`. The tests use `parentId: "skills"`, which matches no schema ID. CONTEXT.md: "Changes and Evidence refer to Items by that ID". Give containers addressable IDs or define a typed parent reference.
4. **`replace` can only target text** (`change.ts`). It takes `targetItemId` plus a string. Experience, education and project entries have non-text fields (title, company, dates). CONTEXT.md: Change is a "modification to a single field of the CV". Add a field path/selector or restrict and document what `replace` can touch.
5. **`DateRangeSchema` accepts invalid data** (`cv.ts`). `current: true` with a non-null `end` passes, and so does `end < start`. Add a refinement and tests.
6. **`RunView` hides evidence and reason** (`run-view.ts`). `RequirementCoverageViewSchema` drops `evidenceIds` and `reason`, and no Evidence is exposed. CONTEXT.md: coverage is "with the CV evidence cited". Include them, or document how the UI gets them.

## Should fix

7. **No schema for graph state** (ADR-0003: "Everything a Run produces ... lives in the graph state"). Only the `RunView` projection exists. Decide whether a `RunState` schema belongs in this change. Either way, Confirmed Gaps need a stored set (CONTEXT.md: "not asked about again"); today only `confirmedGap: boolean` exists in the view.
8. **Terminology alignment with `CONTEXT.md`:**
   - Verdict `partial` should be "partially met".
   - Importance `must`/`nice` should match "must-have"/"nice-to-have" (or add the short codes to the glossary).
   - `Job*` names (`job.ts`, `RunView.job`): the glossary calls this Job Description and lists "job" under Avoid. Rename to `JobDescription*` or add a glossary entry explaining the parsed form.
   - Make coverage naming consistent: `Coverage` vs `RequirementCoverageView`.
   - Add `Question`, `Answer` and `UserEvidence` to `CONTEXT.md` if they stay.
9. **Remove the duplicate `CoverageJudgmentSchema`** (`coverage.ts`). Its own comment says it is the same shape as `CoverageSchema` and "kept separate for clarity". Delete it or alias it.
10. **Remove invented behaviour or justify it.** These are not in any spec: `VERDICT_CREDIT` (1/0.5/0) and `IMPORTANCE_WEIGHT` (3/1), the `StepKey` / `RunErrorCode` / `ExitReason` enums, the `interrupted` status, the `download` shape, and `RequirementKind`. Delete them, or record each in an ADR or the glossary.
11. **Inconsistent `score` shape** (`run-view.ts`). It is `ScoreSchema` in `tailoring` but `{before, after}` in review, with no explanation. Unify it or comment why.
12. **Missing tests** (`schemas.test.ts`):
    - a positive `CvSchema` parse (only the negative "requires IDs" case exists)
    - `RunView` in the `tailoring`, `awaiting_review` and `completed` states
    - the `DateRangeSchema` refinement from item 5

## Consider

13. **Branded IDs.** `EvidenceIdSchema = IdSchema` means `targetItemId` accepts a requirement ID. Brand `ItemId` / `RequirementId` / `EvidenceId`.
14. **Derive `RunStatusSchema` from the `RunViewSchema` union** (or the reverse) so adding a status is one edit.
15. **Small helpers to cut duplication:**
    - a shared shape for the `z.array(z.object({ id, ...fields, bullets }))` pattern repeated three times in `cv.ts`
    - a `BeforeAfter<T>` helper for the repeated `{ before, after }` pairs
16. **`z.iso.datetime()` rejects offsets like `+02:00`.** Fine if the backend always emits `Z`; add `{ offset: true }` or document the assumption.
17. **Run ID entropy.** CONTEXT.md says Runs are "addressed by an unguessable ID", but `IdSchema` is only `min(1)`. Enforce it for the Run ID or document that the backend guarantees it.
18. **Generic names** (`base`, `envelope`, `reviewData`): rename to say what they hold.
19. **`export *` in `index.ts`** fails silently on name collisions. Low risk for now.

## Confirmed OK

- ADR-0003's "never `remove`" rule is honoured and tested.
- `TextItem` and per-Item IDs match the glossary.
- No glossary "Avoid" terms in code names.
