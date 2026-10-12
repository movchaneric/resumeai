import { z } from "zod";
import { ItemIdSchema, QuestionIdSchema, RequirementIdSchema, UserEvidenceIdSchema } from "./common.js";

/*
 * Evidence is referenced by ID: either a CV Item ID, or the ID of a UserEvidence (a fact the
 * user supplied while answering a Question). UserEvidence is trusted and skips LLM claim validation.
 */
export const EvidenceIdSchema = z.union([ItemIdSchema, UserEvidenceIdSchema]);
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;

export const QuestionSchema = z.object({
  id: QuestionIdSchema,
  requirementId: RequirementIdSchema,
  text: z.string(),
});
export type Question = z.infer<typeof QuestionSchema>;

/** `no_experience` turns the Requirement into a Confirmed Gap. */
export const AnswerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("has_experience"), questionId: QuestionIdSchema, text: z.string().min(1) }),
  z.object({ kind: z.literal("no_experience"), questionId: QuestionIdSchema }),
]);
export type Answer = z.infer<typeof AnswerSchema>;

export const UserEvidenceSchema = z.object({
  id: UserEvidenceIdSchema,
  questionId: QuestionIdSchema,
  requirementId: RequirementIdSchema,
  text: z.string(),
});
export type UserEvidence = z.infer<typeof UserEvidenceSchema>;
