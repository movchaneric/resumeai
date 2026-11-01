import { z } from "zod";
import { RunIdSchema, ScoreSchema } from "./common.js";
import { RunStatusSchema } from "./run-view.js";

/** One Owned Run in My Runs. The job and the Match Score are `null` until the Run has them (no Job Profile yet, or not yet scored). */
export const RunSummarySchema = z.object({
  id: RunIdSchema,
  status: RunStatusSchema,
  createdAt: z.iso.datetime(),
  jobTitle: z.string().nullable(),
  company: z.string().nullable(),
  matchScore: ScoreSchema.nullable(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

/** `GET /runs`: the Account's unexpired Owned Runs, newest first. */
export const MyRunsSchema = z.object({ runs: z.array(RunSummarySchema) });
export type MyRuns = z.infer<typeof MyRunsSchema>;

/** The most Guest Run IDs one claim may carry. */
export const MAX_CLAIM_IDS = 50;

/** One Guest Run to claim: its ID and the claim token `POST /runs` returned to the browser that started it. A malformed ID is ignored by the server, so the ID is a plain string. */
export const ClaimRunItemSchema = z.object({ id: z.string().min(1), claimToken: z.string().min(1).max(128) });
export type ClaimRunItem = z.infer<typeof ClaimRunItemSchema>;

/** `POST /runs/claim`: the Guest Runs the browser started, each with its claim token. */
export const ClaimRunsRequestSchema = z.object({ runs: z.array(ClaimRunItemSchema).min(1).max(MAX_CLAIM_IDS) });
export type ClaimRunsRequest = z.infer<typeof ClaimRunsRequestSchema>;

/** The IDs that became Owned Runs. */
export const ClaimRunsResponseSchema = z.object({ claimed: z.array(RunIdSchema) });
export type ClaimRunsResponse = z.infer<typeof ClaimRunsResponseSchema>;

/** `POST /runs`: the new Run's ID, and for a Guest Run the claim token, shown once and never returned again. An Owned Run has none. */
export const CreateRunResponseSchema = z.object({ id: RunIdSchema, claimToken: z.string().min(1).optional() });
export type CreateRunResponse = z.infer<typeof CreateRunResponseSchema>;
