import { CoverageSchema } from "@resume-ai/shared";
import type { Coverage, CoverageVerdict, Cv, Requirement } from "@resume-ai/shared";

/** The model's Coverage answer. The model schema in `assessCoverage` must match this, field order included. */
export type CoverageAnswer = {
  verdicts: { requirementId: string; reason: string; evidenceIds: string[]; verdict: CoverageVerdict }[];
};

/** Replaces the model's reason when a `met` verdict is downgraded, because the model's reason would contradict it. */
export const CLAIM_DOWNGRADE_REASON =
  "Listed in the skills or summary, but no experience, project or education Item shows it.";

/**
 * A Claim is the CV saying something about the candidate without showing it in use: the summary or a skills entry.
 * This relies on slice 2's IDs, where the prefix comes from the section type (never the candidate's heading):
 * `summary` and `skill<N>` are always the summary and the skills list.
 */
export function isClaimId(id: string): boolean {
  return id === "summary" || /^skill[0-9]+$/.test(id);
}

/** Every Item ID in the CV: the contact, the summary, each Item and each bullet. */
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
    ids.add(section.id);
    for (const item of section.items) ids.add(item.id);
  }
  return ids;
}

/**
 * Structural problems that warrant a retry, as readable lines (`req3: ...`):
 * a Requirement with no verdict or several, a verdict for a Requirement not in the list,
 * an Evidence ID that is not in the CV, `met` / `partially_met` with no Evidence.
 */
export function coverageIssues(requirements: Requirement[], cv: Cv, answer: CoverageAnswer): string[] {
  const issues: string[] = [];
  const known = new Set<string>(requirements.map((r) => r.id));
  const itemIds = collectItemIds(cv);

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
 * The Claim rule: a `met` verdict whose Evidence is all Claims becomes `partially_met` with a fixed reason,
 * unless the Requirement is a language. Returns `Coverage[]` in Requirement order.
 * Call it only after `coverageIssues` returned no issues.
 */
export function applyClaimRule(
  requirements: Requirement[],
  answer: CoverageAnswer,
): { coverage: Coverage[]; downgrades: number } {
  const byId = new Map(answer.verdicts.map((v) => [v.requirementId, v]));
  let downgrades = 0;
  const coverage = requirements.map((requirement) => {
    const v = byId.get(requirement.id);
    if (v === undefined) throw new Error(`No verdict for ${requirement.id}; run coverageIssues first`);
    const onlyClaims = v.evidenceIds.length > 0 && v.evidenceIds.every(isClaimId);
    if (v.verdict === "met" && onlyClaims && requirement.kind !== "language") {
      downgrades += 1;
      return CoverageSchema.parse({
        requirementId: v.requirementId,
        verdict: "partially_met",
        evidenceIds: v.evidenceIds,
        reason: CLAIM_DOWNGRADE_REASON,
      });
    }
    return CoverageSchema.parse({
      requirementId: v.requirementId,
      verdict: v.verdict,
      evidenceIds: v.evidenceIds,
      reason: v.reason,
    });
  });
  return { coverage, downgrades };
}
