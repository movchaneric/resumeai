import { z } from "zod";
import { RequirementIdSchema, RunIdSchema, ScoreSchema, beforeAfter } from "./common.js";
import { ChangeSchema } from "./change.js";
import { CoverageSchema, CoverageVerdictSchema } from "./coverage.js";
import { CvSchema } from "./cv.js";
import { QuestionSchema, UserEvidenceSchema } from "./evidence.js";
import { ImportanceSchema } from "./job-profile.js";

export const StepKeySchema = z.enum(["parse", "extract", "coverage", "questions", "tailor", "review", "export"]);
export const StepStateSchema = z.enum(["pending", "running", "done", "failed"]);
export type StepState = z.infer<typeof StepStateSchema>;

export const ExitReasonSchema = z.enum(["ceiling", "plateau", "max_iterations", "target_reached", "error"]);
export type ExitReason = z.infer<typeof ExitReasonSchema>;

export const RunErrorCodeSchema = z.enum([
  "UNSUPPORTED_FILE",
  "FILE_TOO_LARGE",
  "TOO_MANY_PAGES",
  "SCANNED_PDF",
  "JOB_DESCRIPTION_TOO_LONG",
  "UNREADABLE_FILE",
  "EXTRACTION_FAILED",
  "NO_REQUIREMENTS",
  "COVERAGE_FAILED",
  "INTERNAL",
]);
export type RunErrorCode = z.infer<typeof RunErrorCodeSchema>;

// Timestamps are ISO-8601 in UTC with a "Z" suffix (the backend emits Date#toISOString()); offsets such as +02:00 are rejected on purpose.
const runViewCommon = {
  id: RunIdSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  job: z.object({ title: z.string().nullable(), company: z.string().nullable() }).nullable(),
  steps: z.array(z.object({ key: StepKeySchema, state: StepStateSchema })),
};

const IterationsSchema = z.object({ used: z.number().int().min(0), max: z.number().int().min(1) });

/** One row of the Requirement checklist: the verdict before tailoring, and the final verdict with its reasoning. */
export const RequirementCoverageSummarySchema = z.object({
  id: RequirementIdSchema,
  text: z.string(),
  importance: ImportanceSchema,
  before: CoverageVerdictSchema,
  after: CoverageSchema.pick({ verdict: true, evidenceIds: true, reason: true }),
  confirmedGap: z.boolean(),
});
export type RequirementCoverageSummary = z.infer<typeof RequirementCoverageSummarySchema>;

/** Data shared by `awaiting_review` and `completed`. */
const reviewSummaryFields = {
  score: beforeAfter(ScoreSchema),
  requirements: z.array(RequirementCoverageSummarySchema),
  cv: CvSchema,
  changes: z.array(ChangeSchema),
  userEvidence: z.array(UserEvidenceSchema),
  iterations: IterationsSchema,
  exitReason: ExitReasonSchema,
};

export const RunViewSchema = z.discriminatedUnion("status", [
  z.object({ ...runViewCommon, status: z.literal("parsing") }),
  z.object({ ...runViewCommon, status: z.literal("extracting") }),
  z.object({ ...runViewCommon, status: z.literal("awaiting_answers"), questions: z.array(QuestionSchema) }),
  z.object({
    ...runViewCommon,
    status: z.literal("tailoring"),
    iterations: IterationsSchema,
    score: z.object({ before: ScoreSchema, after: ScoreSchema.nullable() }),
  }),
  z.object({ ...runViewCommon, status: z.literal("awaiting_review"), ...reviewSummaryFields }),
  z.object({
    ...runViewCommon,
    status: z.literal("completed"),
    ...reviewSummaryFields,
    download: z.object({ docx: z.string().nullable(), pdf: z.string().nullable() }),
  }),
  z.object({
    ...runViewCommon,
    status: z.literal("failed"),
    error: z.object({ code: RunErrorCodeSchema, message: z.string() }),
  }),
  z.object({ ...runViewCommon, status: z.literal("interrupted") }),
]);
export type RunView = z.infer<typeof RunViewSchema>;
export type RunStatus = RunView["status"];
