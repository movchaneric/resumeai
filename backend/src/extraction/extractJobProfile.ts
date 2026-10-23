import {
  ExtractedJobProfileSchema,
  JobProfileSchema,
  type ExtractedJobProfile,
  type JobProfile,
} from "@resume-ai/shared";
import { ExtractionError, NoRequirementsError } from "@/extraction/errors.js";
import { LlmSchemaError, type LlmClient, type LlmMessage } from "@/llm/llmClient.js";
import { withSpan } from "@/utils/spans.js";

export const JOB_PROFILE_SYSTEM_PROMPT = `You extract a structured profile from a job description.

Rules:
- Extract the job title and the company name. Use null for either when the job description does not state it.
- Split the requirements so that each requirement is a single skill, qualification or responsibility. Never combine several into one.
- "text" is a short normalized form of the requirement, for example "Node.js, 5+ years".
- "source" quotes ONLY the one line or sentence that the requirement came from, copied verbatim. Never quote the whole list or the whole requirements section.
- "importance": use "must_have" for required or expected items. Use "nice_to_have" only for preferred or bonus items. Use "must_have" when the item is not labeled either way.
- "kind" is exactly one of: skill, experience, education, certification, language, responsibility, other.
- Do not invent requirements that the job description does not contain.`;

const RETRY_INSTRUCTION =
  "Your previous answer did not follow the schema. Problems found:\n{issues}\n\nAnswer again with a corrected result that follows the schema exactly.";

const CALL_NAME = "extract_job_profile";

export function assignJobProfileIds(extracted: ExtractedJobProfile): JobProfile {
  return JobProfileSchema.parse({
    ...extracted,
    requirements: extracted.requirements.map((requirement, index) => ({
      id: `req${index + 1}`,
      ...requirement,
    })),
  });
}

export async function extractJobProfile(llm: LlmClient, jobDescriptionText: string): Promise<JobProfile> {
  return withSpan(CALL_NAME, async (span) => {
    const messages: LlmMessage[] = [
      { role: "system", content: JOB_PROFILE_SYSTEM_PROMPT },
      { role: "user", content: jobDescriptionText },
    ];

    let extracted: ExtractedJobProfile;
    span.setAttribute("extraction.retries", 0);
    try {
      extracted = await llm.structured(ExtractedJobProfileSchema, messages, { name: CALL_NAME });
    } catch (error) {
      if (!(error instanceof LlmSchemaError)) throw error;
      span.setAttribute("extraction.retries", 1);
      const retryMessages: LlmMessage[] = [
        ...messages,
        { role: "user", content: RETRY_INSTRUCTION.replace("{issues}", error.issues.map((i) => `- ${i}`).join("\n")) },
      ];
      try {
        extracted = await llm.structured(ExtractedJobProfileSchema, retryMessages, { name: CALL_NAME });
      } catch (retryError) {
        if (retryError instanceof LlmSchemaError) {
          throw new ExtractionError("The model did not return a valid job profile", retryError.issues);
        }
        throw retryError;
      }
    }

    if (extracted.requirements.length === 0) throw new NoRequirementsError();
    return assignJobProfileIds(extracted);
  });
}
