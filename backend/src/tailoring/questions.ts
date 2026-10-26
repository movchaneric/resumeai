import { QuestionIdSchema, type Coverage, type Question, type Requirement } from "@resume-ai/shared";
import { requirementWeight } from "@/scoring/weights.js";

/** The most Questions a Run asks, so the user never faces a long list. */
export const MAX_QUESTIONS = 5;

/**
 * One Question per must-have that Coverage judged `unmet` or `partially_met` (any kind), heaviest first and then in
 * Requirement order, at most MAX_QUESTIONS. The text is a template: no model call.
 */
export function selectQuestions(requirements: Requirement[], coverage: Coverage[]): Question[] {
  const verdicts = new Map(coverage.map((c) => [c.requirementId as string, c.verdict]));
  return requirements
    .filter((r) => r.importance === "must_have" && ["unmet", "partially_met"].includes(verdicts.get(r.id) ?? "met"))
    .map((requirement, order) => ({ requirement, order }))
    .sort((a, b) => requirementWeight(b.requirement) - requirementWeight(a.requirement) || a.order - b.order)
    .slice(0, MAX_QUESTIONS)
    .map(({ requirement }, i) => ({
      id: QuestionIdSchema.parse(`q${i + 1}`),
      requirementId: requirement.id,
      text: `The job asks for: ${requirement.text}. Have you done this? Describe where and how.`,
    }));
}
