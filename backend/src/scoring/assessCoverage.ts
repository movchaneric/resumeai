import { z } from "zod";
import type { Coverage, Cv, Requirement } from "@resume-ai/shared";
import { LlmSchemaError, type LlmClient, type LlmMessage } from "@/llm/llmClient.js";
import { renderCv, renderRequirements } from "@/prompts/renderCv.js";
import { applyClaimRule, coverageIssues, type CoverageAnswer } from "@/scoring/coverageRules.js";
import { CoverageError } from "@/scoring/errors.js";
import { withSpan } from "@/utils/spans.js";

export const COVERAGE_SYSTEM_PROMPT = `You judge how well a CV covers a list of job Requirements.

Rules:
- Judge only the listed Requirements, and give exactly one verdict for each.
- Cite Item IDs exactly as shown in brackets in the CV, for example exp1.b2. Never invent an ID.
- "met" needs an Item that shows the Requirement in use: a job, a bullet, a project, education, a certification or an entry in another section. The skills list or the summary alone is at most "partially_met", except for language Requirements.
- A duration such as "3+ years" is "met" only when the dates of the cited Items prove it. A bare year cannot prove a duration, so use "partially_met" and say so in the reason.
- "unmet" cites no Evidence. "met" and "partially_met" cite at least one Item.
- Write the reason first (1 to 2 sentences), then the Evidence IDs, then the verdict.
- Never assume experience the CV does not show.`;

const RETRY_INSTRUCTION =
  "Your previous answer had problems:\n{issues}\n\nAnswer again for all the listed Requirements with a corrected result that follows the rules and the schema exactly.";

const CALL_NAME = "assess_coverage";

/** Matches `CoverageAnswer`, field order included: the reason comes before the verdict. Plain strings keep strict mode simple. */
const CoverageAnswerSchema = z.object({
  verdicts: z.array(
    z.object({
      requirementId: z.string(),
      reason: z.string().describe("1 to 2 sentences, written before deciding"),
      evidenceIds: z.string().array().describe("Item IDs exactly as shown in brackets"),
      verdict: z.enum(["met", "partially_met", "unmet"]),
    }),
  ),
}) satisfies z.ZodType<CoverageAnswer>;

const asLines = (issues: string[]) => issues.map((i) => `- ${i}`).join("\n");

export async function assessCoverage(
  llm: LlmClient,
  cv: Cv,
  requirements: Requirement[],
): Promise<{ coverage: Coverage[]; downgrades: number }> {
  return withSpan(CALL_NAME, async (span) => {
    const messages: LlmMessage[] = [
      { role: "system", content: COVERAGE_SYSTEM_PROMPT },
      { role: "user", content: `Requirements:\n${renderRequirements(requirements)}\n\nCV:\n${renderCv(cv)}` },
    ];

    /** One model call. Returns the answer, or the issues that make it unusable. */
    const attempt = async (input: LlmMessage[]): Promise<{ answer: CoverageAnswer } | { issues: string[] }> => {
      try {
        const answer = await llm.structured(CoverageAnswerSchema, input, { name: CALL_NAME });
        const issues = coverageIssues(requirements, cv, answer);
        return issues.length === 0 ? { answer } : { issues };
      } catch (error) {
        if (error instanceof LlmSchemaError) return { issues: error.issues };
        throw error;
      }
    };

    span.setAttribute("coverage.retries", 0);
    let result = await attempt(messages);
    if ("issues" in result) {
      span.setAttribute("coverage.retries", 1);
      const retryMessages: LlmMessage[] = [
        ...messages,
        { role: "user", content: RETRY_INSTRUCTION.replace("{issues}", asLines(result.issues)) },
      ];
      result = await attempt(retryMessages);
      if ("issues" in result) {
        throw new CoverageError("The model did not return a valid coverage assessment", result.issues);
      }
    }

    const { coverage, downgrades } = applyClaimRule(requirements, result.answer);
    span.setAttribute("coverage.downgrades", downgrades);
    for (const verdict of ["met", "partially_met", "unmet"] as const) {
      span.setAttribute(`coverage.${verdict}`, coverage.filter((c) => c.verdict === verdict).length);
    }
    return { coverage, downgrades };
  });
}
