import { createHash } from "node:crypto";
import { ExtractedJobProfileSchema } from "@resume-ai/shared";
import { z } from "zod";
import { JOB_PROFILE_SYSTEM_PROMPT } from "@/extraction/extractJobProfile.js";

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/**
 * The text the cache key is computed from: line endings unified to `\n`, every run of spaces and tabs collapsed to
 * one space, runs of blank lines collapsed to one, and the ends trimmed. Case and wording are kept, so only
 * formatting noise (a re-paste, a different editor) maps to the same key.
 */
export function normalizeJobDescription(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The extraction version: a hash of the judge model name, the Job Profile prompt and the extraction schema (as JSON
 * Schema, so a new enum value such as a Requirement kind changes it). A new version means a new key, so a profile
 * made by older settings is never served (ADR 0007).
 */
export function extractionVersion(input: { modelName: string; prompt: string; schema: z.ZodType }): string {
  return sha256(JSON.stringify([input.modelName, sha256(input.prompt), sha256(JSON.stringify(z.toJSONSchema(input.schema)))]));
}

/** The cache key of a Job Description: sha256 over the extraction version and the normalized text. */
export function jobProfileCacheKey(jobDescriptionText: string, modelName: string): string {
  const version = extractionVersion({ modelName, prompt: JOB_PROFILE_SYSTEM_PROMPT, schema: ExtractedJobProfileSchema });
  return sha256(`${version}\n${normalizeJobDescription(jobDescriptionText)}`);
}
