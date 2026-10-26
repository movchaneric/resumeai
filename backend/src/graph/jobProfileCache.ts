import type { JobProfile } from "@resume-ai/shared";
import { extractJobProfile } from "@/extraction/extractJobProfile.js";
import { jobProfileCacheKey } from "@/extraction/jobProfileKey.js";
import type { LlmClient } from "@/llm/llmClient.js";
import { setActiveSpanAttribute } from "@/utils/spans.js";

/** A lookup of Job Profiles by cache key (ADR 0007). The store implements it; the graph only sees this interface. */
export interface JobProfileCache {
  get(key: string): Promise<JobProfile | null>;
  put(key: string, profile: JobProfile): Promise<void>;
}

/**
 * The Job Profile of a Job Description: from the cache on a hit, otherwise extracted and saved. A cache that throws
 * counts as a miss (on `get`) or is ignored (on `put`), so it never fails a Run. The attribute
 * `jobProfile.cache` goes on the active span (the Run's `pipeline` span) and is `hit`, `miss` or `error` (the read failed).
 */
export async function resolveJobProfile(
  deps: { cache: JobProfileCache; judgeLlm: LlmClient; judgeModel: string },
  jobDescriptionText: string,
): Promise<JobProfile> {
  const key = jobProfileCacheKey(jobDescriptionText, deps.judgeModel);
  let cached: JobProfile | null = null;
  let readFailed = false;
  try {
    cached = await deps.cache.get(key);
  } catch {
    readFailed = true;
  }
  setActiveSpanAttribute("jobProfile.cache", cached ? "hit" : readFailed ? "error" : "miss");
  if (cached) return cached;

  const profile = await extractJobProfile(deps.judgeLlm, jobDescriptionText);
  try {
    await deps.cache.put(key, profile);
  } catch {
    // A failed save only means the next Run extracts again.
  }
  return profile;
}
