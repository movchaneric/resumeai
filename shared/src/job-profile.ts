import { z } from "zod";
import { RequirementIdSchema } from "./common.js";

export const RequirementKindSchema = z.enum([
  "skill",
  "experience",
  "education",
  "certification",
  "language",
  "responsibility",
  "soft_skill",
  "other",
]);
export type RequirementKind = z.infer<typeof RequirementKindSchema>;

export const ImportanceSchema = z.enum(["must_have", "nice_to_have"]);
export type Importance = z.infer<typeof ImportanceSchema>;

const requirementFields = {
  text: z.string().describe("Short normalized form, e.g. 'Node.js, 5+ years'. One requirement only."),
  source: z.string().describe("Verbatim quote from the job description this requirement came from"),
  kind: RequirementKindSchema,
  importance: ImportanceSchema.describe(
    "'must_have' for required/expected; 'nice_to_have' only for preferred/bonus. Default to 'must_have' when unlabeled.",
  ),
};

/** The Job Description in structured form: what the extraction chain returns. */
export const ExtractedJobProfileSchema = z.object({
  title: z.string().nullable(),
  company: z.string().nullable(),
  requirements: z.array(z.object(requirementFields)),
});
export type ExtractedJobProfile = z.infer<typeof ExtractedJobProfileSchema>;

export const RequirementSchema = z.object({ id: RequirementIdSchema, ...requirementFields });
export type Requirement = z.infer<typeof RequirementSchema>;

export const JobProfileSchema = z.object({
  title: z.string().nullable(),
  company: z.string().nullable(),
  requirements: z.array(RequirementSchema),
});
export type JobProfile = z.infer<typeof JobProfileSchema>;
