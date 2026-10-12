import { z } from "zod";
import { RequirementIdSchema } from "./common.js";
import { EvidenceIdSchema } from "./evidence.js";

export const CoverageVerdictSchema = z.enum(["met", "partially_met", "unmet"]);
export type CoverageVerdict = z.infer<typeof CoverageVerdictSchema>;

export const CoverageSchema = z.object({
  requirementId: RequirementIdSchema,
  verdict: CoverageVerdictSchema,
  evidenceIds: z.array(EvidenceIdSchema),
  reason: z.string(),
});
export type Coverage = z.infer<typeof CoverageSchema>;
