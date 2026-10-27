import { ExtractedCvSchema, normalizeDateRange } from "@resume-ai/shared";
import type { Cv, ExtractedCv } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";
import { ExtractionError } from "@/extraction/errors.js";
import { checkVerbatim } from "@/extraction/verbatim.js";
import { LlmSchemaError } from "@/llm/llmClient.js";
import type { LlmClient, LlmMessage } from "@/llm/llmClient.js";
import { withSpan } from "@/utils/spans.js";

export const EXTRACT_CV_SYSTEM_PROMPT = `You extract the structure of a CV (resume) from its plain text.

Rules:
- Copy text verbatim from the CV. Never paraphrase, translate, summarize, correct or invent anything. Company names, job titles, institutions, degrees, fields and certification names must appear exactly as written.
- The candidate's own headings decide which section content belongs to. A heading that matches none of the typed sections (experience, education, skills, projects, certifications) goes to additionalSections, with the heading as its title.
- A heading that combines a typed section with other content, like "Education & Army" or "Experience and Volunteering", belongs entirely to that typed section: put ALL of its entries there as structured entries with their dates (an army entry under "Education & Army" goes in education). Such a heading never becomes an additional section.
- The headline is the line under the candidate's name that says what they are (for example "Software engineer"). Copy it verbatim; use null when the CV has no such line. Never write one yourself from the experience.
- Dates are "YYYY" or "YYYY-MM". A bare year stays a bare year: never invent a month. Convert month names to numbers ("March 2021" becomes "2021-03"). Never add a month the CV does not show: "2024 - Present" is start "2024", not "2024-01".
- For Present, Current or ongoing, set current to true and end to null.
- The text may come from a two-column layout, so a sidebar block (contact details, skills, languages) can appear before or after the main content, or in the middle of it.
- Use null for any field the CV does not state.`;

type Attempt = { cv: Cv; softMismatches: number } | { issues: string[] };

/**
 * Turns CV text into a validated `Cv` with stable Item IDs. Any schema, empty-CV, verbatim or
 * date problem triggers one retry with the issues fed back; a second failure throws `ExtractionError`.
 * `LlmUnavailableError` is not caught.
 */
export async function extractCv(llm: LlmClient, cvText: string): Promise<{ cv: Cv; softMismatches: number }> {
  return withSpan("extract_cv", async (span) => {
    const messages: LlmMessage[] = [
      { role: "system", content: EXTRACT_CV_SYSTEM_PROMPT },
      { role: "user", content: cvText },
    ];

    span.setAttribute("extraction.retries", 0);
    const first = await attempt(llm, messages, cvText);
    if (!("issues" in first)) {
      span.setAttribute("extraction.soft_mismatches", first.softMismatches);
      return first;
    }

    span.setAttribute("extraction.retries", 1);
    const retryMessages: LlmMessage[] = [
      ...messages,
      {
        role: "user",
        content: `Your previous extraction had these problems:\n${first.issues.map((i) => `- ${i}`).join("\n")}\nExtract the CV again from the same text and fix them.`,
      },
    ];
    const second = await attempt(llm, retryMessages, cvText);
    if (!("issues" in second)) {
      span.setAttribute("extraction.soft_mismatches", second.softMismatches);
      return second;
    }
    throw new ExtractionError("CV extraction failed after a retry", second.issues);
  });
}

async function attempt(llm: LlmClient, messages: LlmMessage[], cvText: string): Promise<Attempt> {
  let extracted: ExtractedCv;
  try {
    extracted = await llm.structured(ExtractedCvSchema, messages, { name: "extract_cv" });
  } catch (error) {
    if (error instanceof LlmSchemaError) return { issues: error.issues };
    throw error;
  }

  extracted = normalizeRanges(extracted);
  const issues: string[] = [];
  if (isEmpty(extracted)) issues.push("No CV content was found");
  const verbatim = checkVerbatim(extracted, cvText);
  issues.push(...verbatim.issues);

  let cv: Cv | undefined;
  try {
    cv = assignCvIds(extracted);
  } catch (error) {
    if (!(error instanceof ExtractionError)) throw error;
    issues.push(...error.issues);
  }

  if (issues.length > 0 || !cv) return { issues };
  return { cv, softMismatches: verbatim.softMismatches };
}

function normalizeRanges(cv: ExtractedCv): ExtractedCv {
  return {
    ...cv,
    experience: cv.experience.map((e) => ({ ...e, dates: normalizeDateRange(e.dates) })),
    education: cv.education.map((e) => ({ ...e, dates: normalizeDateRange(e.dates) })),
    projects: cv.projects.map((p) => ({ ...p, dates: p.dates && normalizeDateRange(p.dates) })),
  };
}

function isEmpty(cv: ExtractedCv): boolean {
  return cv.experience.length + cv.education.length + cv.projects.length + cv.skills.length === 0;
}
