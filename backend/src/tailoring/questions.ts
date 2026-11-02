import { QuestionIdSchema, durationMonthsOf, tenureOf, type Coverage, type Cv, type Question, type Requirement } from "@resume-ai/shared";
import { isClaimId } from "@/scoring/coverageRules.js";
import { requirementWeight } from "@/scoring/weights.js";

/** The most Questions a Run asks, so the user never faces a long list. */
export const MAX_QUESTIONS = 5;

/**
 * A `skill` Requirement that is `partially_met` only because the CV names it in the skills list or summary (all Evidence is a
 * Claim): the CV already says what it can say, the score counts it at half, and asking "have you done this?" would repeat the CV.
 */
function isSkillClaimOnly(requirement: Requirement, coverage: Coverage | undefined): boolean {
  return (
    requirement.kind === "skill" &&
    coverage?.verdict === "partially_met" &&
    coverage.evidenceIds.length > 0 &&
    coverage.evidenceIds.every(isClaimId)
  );
}

/**
 * The specific Question for a duration Requirement ("2+ years") whose cited job starts in a bare year and whose tenure range
 * straddles the duration: the start month would settle it. Null when this does not apply (the template Question is used).
 */
function startMonthQuestion(requirement: Requirement, coverage: Coverage | undefined, cv: Cv, today: Date): string | null {
  const months = durationMonthsOf(requirement.text);
  if (months === null || coverage?.verdict !== "partially_met") return null;
  const cited = new Set(coverage.evidenceIds.map((id) => id.split(".")[0]));
  const job = cv.experience
    .filter((item) => cited.has(item.id))
    .find((item) => {
      const tenure = tenureOf(item.dates, today);
      return tenure !== null && item.dates.start !== null && /^[0-9]{4}$/.test(item.dates.start) && tenure.minMonths < months && months <= tenure.maxMonths;
    });
  if (job === undefined) return null;
  const end = job.dates.current ? "now" : job.dates.end;
  return `Your CV shows ${job.title} at ${job.company} from ${job.dates.start} to ${end}. Which month in ${job.dates.start} did you start? The job asks for ${requirement.text.replace(/[\s.]+$/, "")}.`;
}

/**
 * One Question per must-have that Coverage judged `unmet` or `partially_met` (any kind), heaviest first and then in
 * Requirement order, at most MAX_QUESTIONS. A `skill` Requirement that is partial only because of a Claim is not asked.
 * The text is a template (no model call): the start-month Question for a straddling duration, else the general one.
 * `today` is injected so the tenure arithmetic is pinned in tests.
 */
export function selectQuestions(requirements: Requirement[], coverage: Coverage[], cv: Cv, today: Date): Question[] {
  const byId = new Map(coverage.map((c) => [c.requirementId as string, c]));
  return requirements
    .filter((r) => r.importance === "must_have" && ["unmet", "partially_met"].includes(byId.get(r.id)?.verdict ?? "met"))
    .filter((r) => !isSkillClaimOnly(r, byId.get(r.id)))
    .map((requirement, order) => ({ requirement, order }))
    .sort((a, b) => requirementWeight(b.requirement) - requirementWeight(a.requirement) || a.order - b.order)
    .slice(0, MAX_QUESTIONS)
    .map(({ requirement }, i) => ({
      id: QuestionIdSchema.parse(`q${i + 1}`),
      requirementId: requirement.id,
      text:
        startMonthQuestion(requirement, byId.get(requirement.id), cv, today) ??
        `The job asks for: ${requirement.text.replace(/[\s.]+$/, "")}. Have you done this? Describe where and how.`,
    }));
}
