import { z } from "zod";

/*
 * Branded IDs. All IDs are assigned by our code, never by the LLM. The brand makes the
 * compiler reject, for example, a RequirementId passed where an ItemId is expected.
 */
export const ItemIdSchema = z.string().min(1).brand<"ItemId">();
export type ItemId = z.infer<typeof ItemIdSchema>;

export const RequirementIdSchema = z.string().min(1).brand<"RequirementId">();
export type RequirementId = z.infer<typeof RequirementIdSchema>;

export const QuestionIdSchema = z.string().min(1).brand<"QuestionId">();
export type QuestionId = z.infer<typeof QuestionIdSchema>;

export const UserEvidenceIdSchema = z.string().min(1).brand<"UserEvidenceId">();
export type UserEvidenceId = z.infer<typeof UserEvidenceIdSchema>;

export const ChangeIdSchema = z.string().min(1).brand<"ChangeId">();
export type ChangeId = z.infer<typeof ChangeIdSchema>;

/** Runs are anonymous and addressed only by this ID, so it must be unguessable: a random UUID. */
export const RunIdSchema = z.uuid().brand<"RunId">();
export type RunId = z.infer<typeof RunIdSchema>;

/**
 * Reserved IDs for the top-level lists of the CV. They are the `parentId` of a Change that
 * adds to or reorders one of these lists. Generated Item IDs must never use these values.
 */
export const SectionIdSchema = z.enum(["experience", "education", "skills", "projects", "certifications"]);
export type SectionId = z.infer<typeof SectionIdSchema>;

/** The parent of an `add` / `reorder` Change: an Item (a job, a project, ...) or a top-level list. */
export const ParentIdSchema = z.union([ItemIdSchema, SectionIdSchema]);
export type ParentId = z.infer<typeof ParentIdSchema>;

/** Partial date as written on a CV: "2021" or "2021-03". */
export const PartialDateSchema = z
  .string()
  .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/, "Expected YYYY or YYYY-MM")
  .describe("Partial date: YYYY or YYYY-MM");
export type PartialDate = z.infer<typeof PartialDateSchema>;

/**
 * Unrefined range, used for LLM structured output (a refinement failure there would discard the
 * whole extraction). Run `normalizeDateRange` on it, then validate with `DateRangeSchema`.
 */
export const DateRangeBaseSchema = z.object({
  start: PartialDateSchema.nullable(),
  end: PartialDateSchema.nullable().describe("Null when the role is current or no end date is given"),
  current: z.boolean().describe("True when the CV says present/current/ongoing"),
});

/** First month covered by a partial date; a bare year means January. */
function monthIndex(date: string, fallbackMonth: number): number {
  const [year, month] = date.split("-");
  return Number(year) * 12 + (month === undefined ? fallbackMonth : Number(month) - 1);
}

export const DateRangeSchema = DateRangeBaseSchema.refine((d) => !(d.current && d.end !== null), {
  message: "A current range must not have an end date",
}).refine(
  // A bare-year start counts from January and a bare-year end through December.
  (d) => d.start === null || d.end === null || monthIndex(d.start, 0) <= monthIndex(d.end, 11),
  { message: "End date is before start date" },
);
export type DateRange = z.infer<typeof DateRangeSchema>;

/** `current` wins over a stray end date. */
export function normalizeDateRange(range: z.infer<typeof DateRangeBaseSchema>): z.infer<typeof DateRangeBaseSchema> {
  return range.current ? { ...range, end: null } : range;
}

/** Match Score, 0-100. */
export const ScoreSchema = z.number().min(0).max(100);
export type Score = z.infer<typeof ScoreSchema>;

/** `{ before, after }` pair of the same type. */
export const beforeAfter = <T extends z.ZodType>(schema: T) => z.object({ before: schema, after: schema });
