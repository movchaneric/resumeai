import { z } from "zod";
import { LlmSchemaError, type LlmClient, type LlmMessage } from "@/llm/llmClient.js";
import { renderClaimCheck, type ClaimCheckInput } from "@/prompts/renderClaimCheck.js";
import { ClaimCheckError } from "@/tailoring/claimCheckErrors.js";
import { withSpan } from "@/utils/spans.js";

export type { ClaimCheckInput };

export const CLAIM_CHECK_SYSTEM_PROMPT = `You check whether new CV text is supported by the CV text it was written from.

For each Change you get the Before text (empty for a new Item), the After text, and the Evidence: the original CV text the After text must rest on, and sometimes the user's own statements about their experience. Both count as Evidence. You see nothing else.

Rules:
- "supported" only if every statement in After is stated by the Evidence. After may reword the Evidence and use different wording, but states nothing the Evidence does not state: no new technologies, numbers, scope, roles or achievements.
- A user's own statement is Evidence like CV text: accept the fact as true, and check only that After states nothing beyond it.
- "reasonable inference" and "plausible" are not support. If a statement in After would need an inference from the Evidence, the verdict is "not_supported".
- Added words that carry a fact count: a method, a deliverable, a level of responsibility or a technology that the Evidence does not state makes the Change "not_supported".
- The reason names the first unsupported statement, or says what in the Evidence supports After. 1 to 2 sentences, written before the verdict.
- Give exactly one verdict for each Change, using its ID exactly as shown in brackets. Never invent an ID.

Example (made up):
- Evidence "Built the backend for the orders service in Express". After "Designed and built the REST API for the orders service in Express" is "not_supported": "REST", "API" and "designed" are not stated.
- Evidence "Wrote SQL reports for finance". After "Authored finance reports in SQL" is "supported": same facts, reworded.`;

const RETRY_INSTRUCTION =
  "Your previous answer had problems:\n{issues}\n\nAnswer again with exactly one verdict for every Change, using the schema exactly.";

const CALL_NAME = "claim_check";

const ClaimCheckAnswerSchema = z.object({
  verdicts: z.array(
    z.object({
      id: z.string(),
      reason: z.string().describe("1 to 2 sentences, written before deciding"),
      verdict: z.enum(["supported", "not_supported"]),
    }),
  ),
});
type ClaimCheckAnswer = z.infer<typeof ClaimCheckAnswerSchema>;

export interface ClaimRejection {
  id: string;
  reason: string;
}

function answerIssues(ids: string[], answer: ClaimCheckAnswer): string[] {
  const known = new Set(ids);
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const { id } of answer.verdicts) {
    if (!known.has(id)) issues.push(`${id}: unknown Change ID`);
    else if (seen.has(id)) issues.push(`${id}: more than one verdict`);
    seen.add(id);
  }
  for (const id of ids) if (!seen.has(id)) issues.push(`${id}: has no verdict`);
  return issues;
}

const asLines = (issues: string[]) => issues.map((i) => `- ${i}`).join("\n");

/** Blind check of every Change that passed stage 1. Reorders must not be passed in: they carry no new text. */
export async function claimCheck(
  llm: LlmClient,
  changes: ClaimCheckInput[],
  options: { round?: number } = {},
): Promise<{ supportedIds: string[]; rejections: ClaimRejection[] }> {
  if (changes.length === 0) return { supportedIds: [], rejections: [] };

  return withSpan(CALL_NAME, async (span) => {
    if (options.round !== undefined) span.setAttribute("round", options.round);
    // Copy only the allowed fields, so extra properties on the caller's objects can never reach the prompt.
    const safe = changes.map(({ id, before, after, evidence, userEvidence }) => ({ id, before, after, evidence, userEvidence }));
    const ids = safe.map((c) => c.id);
    const messages: LlmMessage[] = [
      { role: "system", content: CLAIM_CHECK_SYSTEM_PROMPT },
      { role: "user", content: `Changes:\n\n${renderClaimCheck(safe)}` },
    ];

    const attempt = async (input: LlmMessage[]): Promise<{ answer: ClaimCheckAnswer } | { issues: string[] }> => {
      try {
        const answer = await llm.structured(ClaimCheckAnswerSchema, input, { name: CALL_NAME });
        const issues = answerIssues(ids, answer);
        return issues.length === 0 ? { answer } : { issues };
      } catch (error) {
        if (error instanceof LlmSchemaError) return { issues: error.issues };
        throw error;
      }
    };

    span.setAttribute("claim_check.retries", 0);
    let result = await attempt(messages);
    if ("issues" in result) {
      span.setAttribute("claim_check.retries", 1);
      result = await attempt([
        ...messages,
        { role: "user", content: RETRY_INSTRUCTION.replace("{issues}", asLines(result.issues)) },
      ]);
      if ("issues" in result) {
        throw new ClaimCheckError("The model did not return a valid claim check", result.issues);
      }
    }

    const byId = new Map(result.answer.verdicts.map((v) => [v.id, v]));
    const supportedIds = ids.filter((id) => byId.get(id)!.verdict === "supported");
    const rejections = ids
      .filter((id) => byId.get(id)!.verdict === "not_supported")
      .map((id) => ({ id, reason: byId.get(id)!.reason }));
    span.setAttribute("claim_check.changes", ids.length);
    span.setAttribute("claim_check.supported", supportedIds.length);
    span.setAttribute("claim_check.not_supported", rejections.length);
    return { supportedIds, rejections };
  });
}
