import { z } from "zod";
import { ChangeIdSchema, ItemIdSchema, ParentIdSchema, RequirementIdSchema } from "./common.js";
import { EvidenceIdSchema } from "./evidence.js";

/**
 * `revised` means the user supplied their own version: `after` (or `orderedItemIds` for a
 * reorder) then holds the user's text, and the Change is trusted (no LLM claim validation)
 * and locked against further rewriting. The tailoring proposal it replaced is not kept.
 */
export const ChangeStatusSchema = z.enum(["proposed", "accepted", "rejected", "revised"]);
export type ChangeStatus = z.infer<typeof ChangeStatusSchema>;

const changeCommon = {
  id: ChangeIdSchema,
  rationale: z.string(),
  evidenceIds: z.array(EvidenceIdSchema),
  requirementIds: z.array(RequirementIdSchema),
  status: ChangeStatusSchema,
};

/*
 * Operations: replace, add, reorder, and `remove`, which only Condensing proposes, to fit one page (see ADR-0003).
 * A `remove` drops a bullet of the original CV; it carries no text, so its `evidenceIds` and `requirementIds` are empty.
 * `replace` only rewrites the text of a text Item (bullet, skill, summary, additional-section
 * item); company, title, dates and degrees are never targets. Claim validation (step 8) rejects a
 * `replace` whose target is not a text Item, and an `add` / `replace` with no Evidence. The schema
 * allows both so that rejected drafts can still be represented.
 */
export const ChangeSchema = z.discriminatedUnion("op", [
  z.object({
    ...changeCommon,
    op: z.literal("replace"),
    targetItemId: ItemIdSchema,
    before: z.string(),
    after: z.string(),
  }),
  z.object({
    ...changeCommon,
    op: z.literal("remove"),
    targetItemId: ItemIdSchema,
    before: z.string(),
  }),
  z.object({
    ...changeCommon,
    op: z.literal("add"),
    parentId: ParentIdSchema.describe("The job/project/section that receives the new Item, or a top-level list"),
    after: z.string(),
  }),
  z.object({
    ...changeCommon,
    op: z.literal("reorder"),
    parentId: ParentIdSchema,
    orderedItemIds: z.array(ItemIdSchema),
  }),
]);
export type Change = z.infer<typeof ChangeSchema>;

/**
 * The user's decision on one Change at Review. A plain shape: whether `after` / `orderedItemIds` fit the Change's `op`
 * (and that a revision has text) is checked by the service, which knows the Run's Changes.
 */
export const ReviewDecisionSchema = z.object({
  changeId: ChangeIdSchema,
  decision: z.enum(["accept", "reject", "revise"]),
  /** The user's text for a revised `replace` or `add`. */
  after: z.string().optional(),
  /** The user's order for a revised `reorder`. */
  orderedItemIds: z.array(ItemIdSchema).optional(),
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;
