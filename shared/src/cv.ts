import { z } from "zod";
import { DateRangeBaseSchema, DateRangeSchema, ItemIdSchema, PartialDateSchema } from "./common.js";

/*
 * Two shapes of the CV:
 *  - ExtractedCv: what the extraction chain returns (no IDs, bullets are plain strings).
 *  - Cv: the same content after our code assigns a stable ID to every Item.
 * The top-level lists (experience, education, skills, projects, certifications) have no ID of
 * their own; they are addressed by the reserved SectionId values in common.ts.
 * Text is copied verbatim from the uploaded document, never paraphrased.
 * Fields are nullable (not optional) so the schema works with strict structured output.
 */

const contactFields = {
  name: z.string(),
  headline: z.string().nullable().describe("The line under the name that says what the candidate is, e.g. 'Software engineer'; null when the CV has none"),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  links: z.array(z.object({ label: z.string().nullable(), url: z.string() })),
};

const experienceFields = {
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
};

const educationFields = {
  institution: z.string(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
};

const projectFields = {
  name: z.string(),
  url: z.string().nullable(),
};

const certificationFields = {
  name: z.string(),
  issuer: z.string().nullable(),
  date: PartialDateSchema.nullable(),
};

// ---- Extracted (no IDs, unrefined dates: run normalizeDateRange, then validate as Cv) ----

export const ExtractedCvSchema = z.object({
  contact: z.object(contactFields),
  summary: z.string().nullable(),
  experience: z.array(z.object({ ...experienceFields, dates: DateRangeBaseSchema, bullets: z.array(z.string()) })),
  education: z.array(z.object({ ...educationFields, dates: DateRangeBaseSchema, bullets: z.array(z.string()) })),
  skills: z.array(z.string()),
  projects: z.array(z.object({ ...projectFields, dates: DateRangeBaseSchema.nullable(), bullets: z.array(z.string()) })),
  certifications: z.array(z.object(certificationFields)),
  additionalSections: z
    .array(
      z.object({
        title: z.string().describe("The candidate's own heading, e.g. 'Volunteering'"),
        items: z.array(z.string()),
      }),
    )
    .describe("Content under headings that match none of the typed sections above"),
});
export type ExtractedCv = z.infer<typeof ExtractedCvSchema>;

// ---- With stable IDs ----

export const TextItemSchema = z.object({ id: ItemIdSchema, text: z.string() });
export type TextItem = z.infer<typeof TextItemSchema>;

export const CvSchema = z.object({
  // An older checkpoint has no `headline`: it reads as null (ADR 0003, no migration).
  contact: z.object({ id: ItemIdSchema, ...contactFields, headline: contactFields.headline.default(null) }),
  summary: TextItemSchema.nullable(),
  experience: z.array(
    z.object({ id: ItemIdSchema, ...experienceFields, dates: DateRangeSchema, bullets: z.array(TextItemSchema) }),
  ),
  education: z.array(
    z.object({ id: ItemIdSchema, ...educationFields, dates: DateRangeSchema, bullets: z.array(TextItemSchema) }),
  ),
  skills: z.array(TextItemSchema),
  projects: z.array(
    z.object({
      id: ItemIdSchema,
      ...projectFields,
      dates: DateRangeSchema.nullable(),
      bullets: z.array(TextItemSchema),
    }),
  ),
  certifications: z.array(z.object({ id: ItemIdSchema, ...certificationFields })),
  additionalSections: z.array(
    z.object({ id: ItemIdSchema, title: z.string(), items: z.array(TextItemSchema) }),
  ),
});
export type Cv = z.infer<typeof CvSchema>;
