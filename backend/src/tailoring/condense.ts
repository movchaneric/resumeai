import { z } from "zod";
import { ChangeSchema } from "@resume-ai/shared";
import type { Change, Coverage, Cv, Requirement, UserEvidence } from "@resume-ai/shared";
import { fitOf, type FitResult } from "@/export/index.js";
import type { LlmClient, LlmMessage } from "@/llm/llmClient.js";
import { renderDropInput, renderRewordInput, type CondenseItem } from "@/prompts/renderCondense.js";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { textItems } from "@/tailoring/cvItems.js";
import { mergeRoundIntoChanges } from "@/tailoring/mergeChanges.js";
import { removableBullets } from "@/tailoring/removable.js";
import { touchedItemIds } from "@/tailoring/roundCoverage.js";
import { validateChanges, type RecordedRejection } from "@/tailoring/validateChanges.js";
import { withSpan, type Span } from "@/utils/spans.js";

export const CONDENSE_REWORD_SYSTEM_PROMPT = `You shorten a CV so that it fits on one page.

You get the Items of the CV that may be shortened, longest first, and how many lines the CV is over one page.

Rules:
- Rewrite an Item in fewer characters. The new text must be shorter than the current text.
- Keep every fact: every number, date, technology, scope and achievement stays. Cut filler words, repeated context and clauses that add nothing, and tighten the wording.
- Add nothing the current text does not state.
- Start with the longest Items, since shortening them saves the most space. Change as many Items as the overflow needs, and no more.
- Give each Item at most one new text.
- Use each Item's ID exactly as shown in brackets.`;

export const CONDENSE_DROP_SYSTEM_PROMPT = `You drop the least relevant bullets from a CV so that it fits on one page.

You get the Requirements of the job, how many lines the CV is over one page, and the only bullets you may drop.

Rules:
- Choose the bullets that matter least for the Requirements. Never choose a bullet you were not offered.
- Drop only as many bullets as the overflow needs: each bullet is about one or two lines. An empty list is allowed.
- Give a short rationale for each.
- Use each bullet's ID exactly as shown in brackets.`;

/** Flat and small on purpose: the code fills in everything else (Evidence, `before`, IDs). */
const RewordAnswerSchema = z.object({
  rewordings: z.array(z.object({ targetItemId: z.string(), text: z.string() })),
});

const DropAnswerSchema = z.object({
  drops: z.array(z.object({ targetItemId: z.string(), rationale: z.string() })),
});

/** What a condense step needs: the original CV, the Changes kept so far (the draft is derived), and the Run's judged data. */
export type CondenseInput = {
  originalCv: Cv;
  /** Every Change so far, tailoring rounds and earlier condense steps, counted as accepted. */
  changes: Change[];
  requirements: Requirement[];
  coverage: Coverage[];
  userEvidence: UserEvidence[];
  /** How far over one page the draft is, in lines. */
  overByLines: number;
  /** 1-based number of the step: 1 is the reword, 2 and 3 are the drops. Used for Change IDs. */
  pass: number;
  /** The tailoring rounds started; recorded with a rejection. */
  round: number;
};

export type CondenseStepResult = {
  /** All Changes after the step: the earlier ones with the step's valid Changes folded in (one Change per Item). */
  changes: Change[];
  /** The Items the step reworded or removed. */
  touched: string[];
  /** The fit of the CV with every Change counted as accepted, after the step. */
  overByLines: number;
  rejections: RecordedRejection[];
};

/** Does the CV with every Change counted as accepted fit one page, and if not, by how many lines is it over? */
export function measureCondense(originalCv: Cv, changes: Change[]): Promise<FitResult> {
  return fitOf(applyChanges(originalCv, changes));
}

const stepId = (pass: number, n: number) => `cd${pass}.c${n}`;

/** After a step: fold the valid Changes in and measure the result. */
async function finishStep(input: CondenseInput, valid: Change[], rejections: RecordedRejection[], span: Span): Promise<CondenseStepResult> {
  const changes = mergeRoundIntoChanges(input.originalCv, input.changes, valid);
  const fit = await fitOf(applyChanges(input.originalCv, changes));
  const overByLines = fit.fits ? 0 : fit.overByLines;
  span.setAttribute("condense.valid", valid.length);
  span.setAttribute("condense.rejected", rejections.length);
  span.setAttribute("condense.fit_after", overByLines);
  return { changes, touched: touchedItemIds(valid), overByLines, rejections };
}

/** Runs `fn` in a span; a throw sets `condense.failed` on it (and the span ends in error, see `withSpan`). */
function condenseSpan<T>(name: string, fn: (span: Span) => Promise<T>): Promise<T> {
  return withSpan(name, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      span.setAttribute("condense.failed", true);
      throw error;
    }
  });
}

/**
 * The reword step: one model call proposing shorter versions of the summary and the original bullets (longest first), then the
 * normal validation (stage 1 with the "must be shorter" rule, then the claim check). Valid ones merge into `changes`.
 * Throws on a model or validation failure; the caller ends condensing.
 */
export async function condenseReword(judgeLlm: LlmClient, input: CondenseInput): Promise<CondenseStepResult> {
  return condenseSpan("condense.reword", async (span) => {
    const draft = applyChanges(input.originalCv, input.changes);
    const draftTexts = textItems(draft);
    const originalTexts = textItems(input.originalCv);
    // Candidates: the summary and the bullets of the original CV (an Item a tailor `add` created has no Evidence to check against).
    const candidates = new Map<string, CondenseItem>();
    for (const [id, item] of draftTexts) {
      if (originalTexts.has(id) && (id === draft.summary?.id || /\.b[0-9]+$/.test(id))) candidates.set(id, { id, text: item.text });
    }

    const messages: LlmMessage[] = [
      { role: "system", content: CONDENSE_REWORD_SYSTEM_PROMPT },
      { role: "user", content: renderRewordInput({ items: [...candidates.values()], overByLines: input.overByLines }) },
    ];
    const answer = await judgeLlm.structured(RewordAnswerSchema, messages, { name: "condense_reword" });

    const seen = new Set<string>();
    const proposed: Change[] = [];
    for (const r of answer.rewordings) {
      // Only listed Items, one rewording each. Whatever else the model sends has no place in the CV.
      if (!candidates.has(r.targetItemId) || seen.has(r.targetItemId)) continue;
      seen.add(r.targetItemId);
      const earlier = input.changes.find((c) => c.op === "replace" && c.targetItemId === r.targetItemId);
      proposed.push(
        ChangeSchema.parse({
          id: stepId(input.pass, proposed.length + 1),
          op: "replace",
          targetItemId: r.targetItemId,
          before: originalTexts.get(r.targetItemId)!.text,
          after: r.text,
          // The Item's own original text is the Evidence; so is whatever the tailor cited for an earlier change of it.
          evidenceIds: [...new Set([r.targetItemId, ...(earlier?.evidenceIds ?? [])])],
          requirementIds: [],
          rationale: "Shortened to fit one page.",
          status: "proposed",
        }),
      );
    }

    const { valid, rejections } = await validateChanges(judgeLlm, {
      original: input.originalCv,
      draft,
      changes: proposed,
      round: input.round,
      userEvidence: input.userEvidence,
      coverage: input.coverage,
      shorter: true,
    });
    return finishStep(input, valid, rejections, span);
  });
}

/**
 * A drop step: one model call picking the least relevant bullets among `removableBullets`, returned as `remove` Changes,
 * validated by stage 1 (cited and last bullets never pass). With no removable bullet there is nothing to ask: no model call.
 */
export async function condenseDrop(judgeLlm: LlmClient, input: CondenseInput): Promise<CondenseStepResult> {
  return condenseSpan("condense.drop", async (span) => {
    const removable = removableBullets(input.originalCv, input.coverage, input.changes);
    if (removable.size === 0) return finishStep(input, [], [], span);

    const draft = applyChanges(input.originalCv, input.changes);
    const texts = textItems(draft);
    const offered = [...removable].flatMap((id) => (texts.has(id) ? [{ id, text: texts.get(id)!.text }] : []));
    const messages: LlmMessage[] = [
      { role: "system", content: CONDENSE_DROP_SYSTEM_PROMPT },
      { role: "user", content: renderDropInput({ bullets: offered, requirements: input.requirements, overByLines: input.overByLines }) },
    ];
    const answer = await judgeLlm.structured(DropAnswerSchema, messages, { name: "condense_drop" });

    const seen = new Set<string>();
    const proposed: Change[] = [];
    for (const d of answer.drops) {
      // Only offered bullets, once each; stage 1 re-checks the rules.
      if (!removable.has(d.targetItemId) || seen.has(d.targetItemId)) continue;
      seen.add(d.targetItemId);
      proposed.push(
        ChangeSchema.parse({
          id: stepId(input.pass, proposed.length + 1),
          op: "remove",
          targetItemId: d.targetItemId,
          before: texts.get(d.targetItemId)!.text,
          evidenceIds: [],
          requirementIds: [],
          rationale: `Dropped to fit one page: ${d.rationale}`,
          status: "proposed",
        }),
      );
    }

    const { valid, rejections } = await validateChanges(judgeLlm, {
      original: input.originalCv,
      draft,
      changes: proposed,
      round: input.round,
      userEvidence: input.userEvidence,
      coverage: input.coverage,
    });
    return finishStep(input, valid, rejections, span);
  });
}
