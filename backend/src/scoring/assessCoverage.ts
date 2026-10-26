import { z } from "zod";
import { CoverageVerdictSchema } from "@resume-ai/shared";
import type { Coverage, CoverageVerdict, Cv, Requirement } from "@resume-ai/shared";
import { LlmSchemaError, type LlmClient, type LlmMessage } from "@/llm/llmClient.js";
import { renderCv, renderRequirements } from "@/prompts/renderCv.js";
import { applyClaimRule, coverageIssues, type CoverageAnswer } from "@/scoring/coverageRules.js";
import { CoverageError } from "@/scoring/errors.js";
import { withSpan } from "@/utils/spans.js";

export const COVERAGE_SYSTEM_PROMPT = `You judge how well a CV covers a list of job Requirements.

Rules:
- Judge only the listed Requirements, and give exactly one verdict for each.
- Cite Item IDs exactly as shown in brackets in the CV, for example exp1.b2. Never invent an ID.
- "met" needs at least one cited Item that states the Requirement directly: the same skill, technology, activity or outcome, in the Item's own words. The Item can be a job, a bullet, a project, education, a certification or an Item in another section. The skills list or the summary alone is at most "partially_met", except for language Requirements.
- Each cited Item must itself support the verdict. Never cite an Item that is unrelated to the Requirement.
- If the reason has to infer the Requirement from something else ("indicating", "suggests", "shows ability to", "implies"), the verdict is at most "partially_met". If no Item states anything related, it is "unmet".
- The reason may only describe what the cited Items say. Never add details that are not in them.
- Requirements of kind soft_skill (ownership, attention to detail, collaboration, iterating quickly) are "met" only when an Item describes that behaviour. Otherwise they are "unmet". Never use "partially_met" for them.
- A duration such as "3+ years" is "met" only when the dates of the cited Items prove it. A bare year cannot prove a duration, so use "partially_met" and say so in the reason.
- "unmet" cites no Evidence. "met" and "partially_met" cite at least one Item.
- Write the reason first (1 to 2 sentences), then the Evidence IDs, then the verdict.
- Never assume experience the CV does not show.

Examples (made up):
- Requirement "Experience with Kubernetes". Item [exp2.b1] "Deployed services to Kubernetes with Helm" gives "met". Item [exp2.b3] "Improved deployment reliability" alone gives "partially_met": it is related but does not state the Requirement.
- Requirement "Iterate quickly and prototype" (soft_skill). Item [exp1.b4] "Built an internal billing dashboard" gives "unmet": building a dashboard does not describe iterating or prototyping, and inferring it is not allowed.`;

const RETRY_INSTRUCTION =
  "Your previous answer had problems:\n{issues}\n\nAnswer again for all the listed Requirements with a corrected result that follows the rules and the schema exactly.";

const CALL_NAME = "assess_coverage";

/**
 * Coverage calls per judgement. One strict call can flip several Requirements at once (slice 18), so the first
 * Coverage and every re-judge make this many calls in parallel and keep the median verdict per Requirement.
 * Odd, so that 3 calls give the majority verdict whenever there is one.
 */
export const COVERAGE_VOTES = 3;

const VERDICT_RANK: Record<CoverageVerdict, number> = { unmet: 0, partially_met: 1, met: 2 };

/**
 * Per Requirement, the median verdict of the calls (unmet < partially_met < met), in Requirement order.
 * With 3 calls that is the majority verdict, or `partially_met` when all differ. With 2 calls it is the lower one,
 * so a vote never inflates. The entry (Evidence and reason) comes from the first call that gave the winning verdict.
 * Each call must hold one entry per Requirement, as `applyClaimRule` returns.
 */
export function voteCoverage(calls: Coverage[][], requirements: Requirement[]): Coverage[] {
  return requirements.map((requirement) => {
    const entries = calls.map((call) => {
      const entry = call.find((c) => c.requirementId === requirement.id);
      if (entry === undefined) throw new Error(`No Coverage for ${requirement.id}`);
      return entry;
    });
    const sorted = [...entries].sort((a, b) => VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]);
    const winning = sorted[Math.floor((sorted.length - 1) / 2)]!.verdict;
    return entries.find((e) => e.verdict === winning)!;
  });
}

/** Matches `CoverageAnswer`, field order included: the reason comes before the verdict. Plain strings keep strict mode simple. */
const CoverageAnswerSchema = z.object({
  verdicts: z.array(
    z.object({
      requirementId: z.string(),
      reason: z.string().describe("1 to 2 sentences, written before deciding"),
      evidenceIds: z.string().array().describe("Item IDs exactly as shown in brackets"),
      verdict: CoverageVerdictSchema,
    }),
  ),
}) satisfies z.ZodType<CoverageAnswer>;

const asLines = (issues: string[]) => issues.map((i) => `- ${i}`).join("\n");


type CallResult = { coverage: Coverage[]; downgrades: number };

/** One independent Coverage call with its own retry, Claim rule and soft-skill rule. */
async function judgeOnce(
  llm: LlmClient,
  cv: Cv,
  requirements: Requirement[],
  onRetry: () => void,
): Promise<CallResult> {
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

  let result = await attempt(messages);
  if ("issues" in result) {
    onRetry();
    const retryMessages: LlmMessage[] = [
      ...messages,
      { role: "user", content: RETRY_INSTRUCTION.replace("{issues}", asLines(result.issues)) },
    ];
    result = await attempt(retryMessages);
    if ("issues" in result) {
      throw new CoverageError("The model did not return a valid coverage assessment", result.issues);
    }
  }
  return applyClaimRule(requirements, result.answer);
}

/**
 * Judges the CV against the Requirements with `options.votes` independent calls in parallel (default
 * `COVERAGE_VOTES`) and votes per Requirement (`voteCoverage`). If at least 2 calls succeed (1 when `votes` is 1)
 * the vote runs over the successful ones; otherwise the first call's error is rethrown unchanged.
 * `downgrades` is the sum over the successful calls: Claim and soft-skill downgrades applied before the vote.
 * One `assess_coverage` span covers the whole judgement (no span per call, so the span tree and the `round`
 * attribute stay one per judgement). Its attributes: the voted verdict counts, `coverage.votes` (calls made),
 * `coverage.failed_calls`, `coverage.disagreements` (Requirements where the successful calls did not all agree),
 * `coverage.retries` (retries made, over all calls) and `coverage.downgrades` (summed over the successful calls).
 */
export async function assessCoverage(
  llm: LlmClient,
  cv: Cv,
  requirements: Requirement[],
  options: { round?: number; votes?: number } = {},
): Promise<{ coverage: Coverage[]; downgrades: number }> {
  const votes = options.votes ?? COVERAGE_VOTES;
  return withSpan(CALL_NAME, async (span) => {
    if (options.round !== undefined) span.setAttribute("round", options.round);
    span.setAttribute("coverage.votes", votes);

    let retries = 0;
    span.setAttribute("coverage.retries", retries);
    const onRetry = () => span.setAttribute("coverage.retries", ++retries);
    const settled = await Promise.allSettled(Array.from({ length: votes }, () => judgeOnce(llm, cv, requirements, onRetry)));
    const succeeded = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const failed = settled.length - succeeded.length;
    span.setAttribute("coverage.failed_calls", failed);
    if (succeeded.length < Math.min(2, votes)) {
      const first = settled.find((r): r is PromiseRejectedResult => r.status === "rejected")!;
      throw first.reason;
    }

    const calls = succeeded.map((r) => r.coverage);
    const coverage = voteCoverage(calls, requirements);
    const downgrades = succeeded.reduce((sum, r) => sum + r.downgrades, 0);
    const disagreements = coverage.filter((c, i) => calls.some((call) => call[i]!.verdict !== c.verdict)).length;

    span.setAttribute("coverage.downgrades", downgrades);
    span.setAttribute("coverage.disagreements", disagreements);
    for (const verdict of CoverageVerdictSchema.options) {
      span.setAttribute(`coverage.${verdict}`, coverage.filter((c) => c.verdict === verdict).length);
    }
    return { coverage, downgrades };
  });
}
