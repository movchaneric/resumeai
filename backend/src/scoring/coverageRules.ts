import { CoverageSchema, durationMonthsOf, tenureOf } from "@resume-ai/shared";
import type { Coverage, CoverageVerdict, Cv, Requirement, UserEvidence } from "@resume-ai/shared";

/** The model's Coverage answer. The model schema in `assessCoverage` must match this, field order included. */
export type CoverageAnswer = {
  verdicts: { requirementId: string; reason: string; evidenceIds: string[]; verdict: CoverageVerdict }[];
};

/** Replaces the model's reason when a `met` verdict is downgraded, because the model's reason would contradict it. */
export const CLAIM_DOWNGRADE_REASON =
  "Listed in the skills or summary, but no experience, project or education Item shows it.";

/** Replaces the model's reason when a `partially_met` soft skill becomes `unmet`: a soft skill is met or it is not. */
export const SOFT_SKILL_DOWNGRADE_REASON = "No Item describes this behaviour, and a soft skill is either met or unmet.";

/** Replaces the model's reason when a `met` duration verdict is downgraded because the cited roles' shortest tenure falls short. */
export const DURATION_DOWNGRADE_REASON =
  "The dates of the cited roles do not prove the duration: even the shortest reading of their dates falls short.";

/**
 * A Claim is the CV saying something about the candidate without showing it in use: the summary or a skill.
 * This relies on slice 2's IDs, where the prefix comes from the section type (never the candidate's heading):
 * `summary` and `skill<N>` are always the summary and the skills list.
 */
export function isClaimId(id: string): boolean {
  return id === "summary" || /^skill[0-9]+$/.test(id);
}

/**
 * Every Item ID in the CV: the contact, the summary, each Item and each bullet.
 * An additional section's own ID (`secN`) is left out: `renderCv` prints only item lines, so the model never sees it.
 */
export function collectItemIds(cv: Cv): Set<string> {
  const ids = new Set<string>([cv.contact.id]);
  if (cv.summary) ids.add(cv.summary.id);
  for (const group of [cv.experience, cv.education, cv.projects]) {
    for (const item of group) {
      ids.add(item.id);
      for (const bullet of item.bullets) ids.add(bullet.id);
    }
  }
  for (const skill of cv.skills) ids.add(skill.id);
  for (const cert of cv.certifications) ids.add(cert.id);
  for (const section of cv.additionalSections) {
    for (const item of section.items) ids.add(item.id);
  }
  return ids;
}

/**
 * Structural problems that warrant a retry, as readable lines (`req3: ...`):
 * a Requirement with no verdict or several, a verdict for a Requirement not in the list,
 * an Evidence ID that is not in the CV, `met` / `partially_met` with no Evidence.
 */
export function coverageIssues(requirements: Requirement[], cv: Cv, answer: CoverageAnswer, userEvidence: UserEvidence[] = []): string[] {
  const issues: string[] = [];
  const known = new Set<string>(requirements.map((r) => r.id));
  const itemIds = collectItemIds(cv);
  for (const u of userEvidence) itemIds.add(u.id);

  const counts = new Map<string, number>();
  for (const v of answer.verdicts) counts.set(v.requirementId, (counts.get(v.requirementId) ?? 0) + 1);

  for (const requirement of requirements) {
    const count = counts.get(requirement.id) ?? 0;
    if (count === 0) issues.push(`${requirement.id}: has no verdict`);
    else if (count > 1) issues.push(`${requirement.id}: has ${count} verdicts, expected one`);
  }

  for (const v of answer.verdicts) {
    if (!known.has(v.requirementId)) {
      issues.push(`${v.requirementId}: is not a Requirement in the list`);
      continue;
    }
    for (const evidenceId of v.evidenceIds) {
      if (!itemIds.has(evidenceId)) issues.push(`${v.requirementId}: Evidence ID ${evidenceId} does not exist in the CV`);
    }
    if (v.verdict !== "unmet" && v.evidenceIds.length === 0) {
      issues.push(`${v.requirementId}: ${v.verdict} but cites no Evidence`);
    }
  }
  return issues;
}

/**
 * Normalizes the model's verdicts. The Claim rule: a `met` verdict whose Evidence is all Claims becomes
 * `partially_met` with a fixed reason, unless the Requirement is a language. An `unmet` verdict has its Evidence
 * list cleared (cited Evidence means "supports the Requirement"); its verdict and reason stay.
 * The soft-skill rule runs on the verdict left by the Claim rule: a `partially_met` verdict (including one the Claim rule would produce) on a `soft_skill` Requirement becomes `unmet` with no Evidence and a fixed reason. Returns `Coverage[]` in Requirement order.
 * Call it only after `coverageIssues` returned no issues.
 */
export function applyClaimRule(
  requirements: Requirement[],
  answer: CoverageAnswer,
  tenure?: { cv: Cv; today: Date; userEvidence?: UserEvidence[] },
): { coverage: Coverage[]; downgrades: number } {
  const byId = new Map(answer.verdicts.map((v) => [v.requirementId, v]));
  let downgrades = 0;
  const coverage = requirements.map((requirement) => {
    const v = byId.get(requirement.id);
    if (v === undefined) throw new Error(`No verdict for ${requirement.id}; run coverageIssues first`);
    const onlyClaims = v.evidenceIds.length > 0 && v.evidenceIds.every(isClaimId);
    const claimDowngrade = v.verdict === "met" && onlyClaims && requirement.kind !== "language";
    // The soft-skill rule applies to the verdict after the Claim rule, and counts one downgrade per Requirement.
    if (requirement.kind === "soft_skill" && (claimDowngrade || v.verdict === "partially_met")) {
      downgrades += 1;
      return CoverageSchema.parse({
        requirementId: v.requirementId,
        verdict: "unmet",
        evidenceIds: [],
        reason: SOFT_SKILL_DOWNGRADE_REASON,
      });
    }
    if (claimDowngrade) {
      downgrades += 1;
      return CoverageSchema.parse({
        requirementId: v.requirementId,
        verdict: "partially_met",
        evidenceIds: v.evidenceIds,
        reason: CLAIM_DOWNGRADE_REASON,
      });
    }
    if (v.verdict === "met" && tenure !== undefined && !provesDuration(requirement, v.evidenceIds, tenure.cv, tenure.today, tenure.userEvidence ?? [])) {
      downgrades += 1;
      return CoverageSchema.parse({
        requirementId: v.requirementId,
        verdict: "partially_met",
        evidenceIds: v.evidenceIds,
        reason: DURATION_DOWNGRADE_REASON,
      });
    }
    return CoverageSchema.parse({
      requirementId: v.requirementId,
      verdict: v.verdict,
      evidenceIds: v.verdict === "unmet" ? [] : v.evidenceIds,
      reason: v.reason,
    });
  });
  return { coverage, downgrades };
}

/** The dated Items (jobs, education, projects) among the Evidence, bullets counted as their parent. */
export function datedEvidence(cv: Cv, evidenceIds: string[]) {
  const roots = new Set(evidenceIds.map((id) => id.split(".")[0]!));
  return [...cv.experience, ...cv.education, ...cv.projects].filter((item) => roots.has(item.id));
}

/**
 * The duration rule, in code: a `met` verdict on a Requirement asking "N years" must be proven by the SHORTEST tenure of
 * at least one cited dated Item (the best single role: roles may overlap, so tenures are not added). When no cited Item has
 * usable dates, or the Requirement has no parsable duration, the model's verdict stands. Only downgrades `met`: upgrading
 * a `partially_met` would need to know why the model held back, which this code cannot tell.
 */
function provesDuration(requirement: Requirement, evidenceIds: string[], cv: Cv, today: Date, userEvidence: UserEvidence[]): boolean {
  const months = durationMonthsOf(requirement.text);
  if (months === null) return true;
  // A cited User answer (for example a start month) can settle what the CV dates cannot; the model uses it, so this check stands aside.
  if (evidenceIds.some((id) => userEvidence.some((u) => u.id === id))) return true;
  const tenures = datedEvidence(cv, evidenceIds).flatMap((item) => {
    const t = tenureOf(item.dates, today);
    return t === null ? [] : [t];
  });
  if (tenures.length === 0) return true;
  return Math.max(...tenures.map((t) => t.minMonths)) >= months;
}
