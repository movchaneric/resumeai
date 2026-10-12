# Conventions for the shared schemas

Decisions made while reviewing the first `shared/` schemas that a reader of the code would otherwise question or "fix".

**A revised Change overwrites the proposal.** When the user revises a Change, their text replaces `after` (or `orderedItemIds` for a reorder) and the status becomes `revised`; the Change is then trusted and locked. The tailoring proposal it replaced is not kept. Keeping it would let the review screen show "what we suggested" next to "what you wrote", at the cost of a second field on every Change. Revisit if users ask to see or restore the original suggestion.

**Top-level lists have reserved IDs.** `experience`, `education`, `skills`, `projects` and `certifications` have no Item of their own, so `add` and `reorder` Changes address them with these fixed `SectionId` values. Generated Item IDs must never collide with them.

**Dates are validated in two stages.** The extraction schema uses an unrefined `DateRangeBaseSchema`, because a failed refinement on LLM output would discard the whole extraction. Our code runs `normalizeDateRange()` and the refined `DateRangeSchema` validates the result when the Item IDs are assigned. This looks like duplication but is deliberate.

**IDs are branded.** `ItemId`, `RequirementId`, `QuestionId`, `UserEvidenceId`, `ChangeId` and `RunId` are distinct types, so the compiler rejects, for example, a Requirement ID used as a target Item. This is cheap now and hard to retrofit, at the cost of parsing IDs through their schemas instead of casting strings. `RunId` is a UUID because it is the only access control on an anonymous Run.

**Scoring constants live in the backend.** The Requirement weights (must-have 3, nice-to-have 1) and the verdict credits (met 1, partially met 0.5, unmet 0) are initial, tunable values in `backend/src/scoring/weights.ts`, not part of the schema contract.

**Still open.** The run view's step keys, error codes, and exit reasons were chosen while writing the schemas and are easy to change.
