import type { Change, Coverage, Cv, UserEvidence } from "@resume-ai/shared";
import { fitOf, type FitResult } from "@/export/index.js";
import type { LlmClient } from "@/llm/llmClient.js";
import { claimCheck, type ClaimCheckInput } from "@/tailoring/claimCheck.js";
import { itemTexts } from "@/tailoring/cvItems.js";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { STAGE1_REASONS, stage1Checks } from "@/tailoring/stage1Checks.js";
import { withSpan } from "@/utils/spans.js";

export type RejectionStage = "stage1" | "claim_check";

/** A Change that did not survive validation, with where it failed and why. The tailor reads these next round. */
export type RecordedRejection = { round: number; change: Change; stage: RejectionStage; reason: string };

export type ValidateInput = {
  original: Cv;
  /** The original plus the Changes kept so far. */
  draft: Cv;
  changes: Change[];
  round: number;
  /** What the user said in the Answers; Changes may cite it as Evidence. */
  userEvidence?: UserEvidence[];
  /** The Coverage a `remove` is checked against: bullets it cites as Evidence cannot be removed. Without it every `remove` is rejected. */
  coverage?: Coverage[];
  /** Condensing: a `replace` must be shorter than the Item's current text (stage 1). */
  shorter?: boolean;
  /** Measures a CV against one page. Defaults to `fitOf`; tests pass a spy. */
  fit?: (cv: Cv) => Promise<FitResult>;
};

/**
 * Stage 1 (code) then the claim check (model) on the Changes that passed and carry new text.
 * Reorders and removes have no new text, so they skip the claim check. Evidence IDs are resolved here: CV Items to the original CV's text, `ue` IDs to the Answer text.
 * Then the page check: when the draft fitted one page and the round's valid Changes tip it over, the round's `add`s are rejected, last proposed first, until it fits again.
 * A draft that was already too long blocks no `add`, and a round without `add`s is not measured.
 * Returns the valid Changes in their proposed order, and the rejections.
 */
export async function validateChanges(
  judgeLlm: LlmClient,
  { original, draft, changes, round, userEvidence = [], coverage, shorter, fit = fitOf }: ValidateInput,
): Promise<{ valid: Change[]; rejections: RecordedRejection[] }> {
  return withSpan("validate", async (span) => {
    span.setAttribute("round", round);
    const { passed, rejected } = stage1Checks(original, draft, changes, userEvidence, { coverage, shorter });
    const rejections: RecordedRejection[] = rejected.map((r) => ({ round, change: r.change, stage: "stage1", reason: r.reason }));

    const texts = itemTexts(original);
    const answers = new Map(userEvidence.map((u) => [u.id as string, u.text]));
    const toCheck: ClaimCheckInput[] = [];
    for (const c of passed) {
      if (c.op === "reorder" || c.op === "remove") continue;
      toCheck.push({
        id: c.id,
        before: c.op === "replace" ? c.before : "",
        after: c.after,
        evidence: c.evidenceIds.flatMap((id) => texts.get(id) ?? []),
        userEvidence: c.evidenceIds.flatMap((id) => answers.get(id) ?? []),
      });
    }

    const { rejections: claimRejections } = await claimCheck(judgeLlm, toCheck, { round });
    const claimReasons = new Map(claimRejections.map((r) => [r.id as string, r.reason]));
    let valid: Change[] = [];
    for (const c of passed) {
      const reason = claimReasons.get(c.id);
      if (reason === undefined) valid.push(c);
      else rejections.push({ round, change: c, stage: "claim_check", reason });
    }

    const pageRejected = await rejectPastOnePage(draft, valid, fit);
    if (pageRejected.length > 0) {
      const dropped = new Set(pageRejected);
      valid = valid.filter((c) => !dropped.has(c));
      for (const change of pageRejected) rejections.push({ round, change, stage: "stage1", reason: STAGE1_REASONS.pastOnePage });
    }

    span.setAttribute("validate.changes", changes.length);
    span.setAttribute("validate.stage1_rejected", rejected.length);
    span.setAttribute("validate.claim_rejected", claimRejections.length);
    span.setAttribute("validate.rejected_past_page", pageRejected.length);
    span.setAttribute("validate.valid", valid.length);
    return { valid, rejections };
  });
}

/** The `add`s to drop so a draft that fitted still fits, last proposed first. Empty when the draft was already too long or the round has no `add`. */
async function rejectPastOnePage(draft: Cv, valid: Change[], fit: (cv: Cv) => Promise<FitResult>): Promise<Change[]> {
  if (!valid.some((c) => c.op === "add")) return [];
  if (!(await fit(draft)).fits) return [];
  const kept = [...valid];
  const dropped: Change[] = [];
  while (!(await fit(applyChanges(draft, kept))).fits) {
    const last = kept.findLastIndex((c) => c.op === "add");
    if (last === -1) break;
    dropped.push(...kept.splice(last, 1));
  }
  return dropped;
}
