import type { Change, Cv, UserEvidence } from "@resume-ai/shared";
import { LIST_IDS, SECTION_ID_PATTERN, allIds, childLists, itemTexts, textItems, textParentIds } from "@/tailoring/cvItems.js";
import { collectItemIds } from "@/scoring/coverageRules.js";

/** The fixed reason recorded for each rejection. The tailor reads them on the next round. */
export const STAGE1_REASONS = {
  unknownTarget: "The target Item does not exist in the CV.",
  notTextItem: "The target is not a text Item; only bullets, skills, the summary and additional-section items can be changed.",
  protectedField: "The target is a job, education, project or certification; dates, companies, titles and degrees are never changed.",
  unknownParent: "The parent does not exist in the CV.",
  parentNotText: "The parent does not accept new text Items.",
  noEvidence: "The Change cites no Evidence.",
  unknownEvidence: "The Change cites an Evidence ID that exists neither in the original CV nor in the User Evidence.",
  sectionEvidence: "A section ID is not Evidence; cite an Item.",
  addedItemEvidence: "An Item added by a Change is never Evidence; cite an Item from the original CV.",
  notPermutation: "The reorder must list exactly the Items currently under the parent, each once.",
  numberDropped: "A number or date in the original text is missing from the new text; numbers and dates must stay as written.",
  itemTag: "The new text contains an Item ID tag like \"[summary]\"; write only the CV text, without IDs.",
  numberAdded: "The new text contains a number or date that is in neither the original text nor the cited Evidence.",
} as const;

export type Stage1Rejection = { change: Change; reason: string };
export type Stage1Result = { passed: Change[]; rejected: Stage1Rejection[] };

/** A number is a run of digits with any decimal part, then an optional `%` or `+`. Dates are covered through their digits. */
const NUMBER = /[0-9]+(?:[.,][0-9]+)*[%+]?/g;

/**
 * A prompt item tag as `renderCv` writes it: `[` + an Item or section ID + `]`. The IDs are `contact`, `summary`,
 * `exp1`, `edu1`, `proj1`, `cert1`, `skill1`, `sec1`, with `.b1` (bullets) or `.i1` (section items) after a parent,
 * plus `ue1` and `req1` from the other prompt blocks. Ordinary brackets like "[beta]" do not match.
 */
const ITEM_TAG = /\[(?:contact|summary|(?:exp|edu|proj)[0-9]+(?:\.b[0-9]+)?|cert[0-9]+|skill[0-9]+|sec[0-9]+(?:\.i[0-9]+)?|ue[0-9]+|req[0-9]+)\]/;

function numbersIn(text: string): Set<string> {
  return new Set(text.match(NUMBER) ?? []);
}

/**
 * Stage-1 code checks (pure). `draft` is the original CV with the Changes validated so far
 * (`applyChanges`); targets and parents are looked up in it, Evidence only in `original`.
 * `userEvidence` is what the user said in the Answers: its IDs (`ue1`) are valid Evidence, and its text counts as cited Evidence for the numbers.
 * Returns the Changes that pass and the rejected ones with a fixed reason; rejected Changes go no further.
 */
export function stage1Checks(original: Cv, draft: Cv, changes: Change[], userEvidence: UserEvidence[] = []): Stage1Result {
  const passed: Change[] = [];
  const rejected: Stage1Rejection[] = [];
  for (const change of changes) {
    const reason = firstProblem(original, draft, change, userEvidence);
    if (reason === null) passed.push(change);
    else rejected.push({ change, reason });
  }
  return { passed, rejected };
}

function firstProblem(original: Cv, draft: Cv, change: Change, userEvidence: UserEvidence[]): string | null {
  const structure = structureProblem(draft, change);
  if (structure !== null) return structure;
  const evidence = evidenceProblem(original, draft, change, userEvidence);
  if (evidence !== null) return evidence;
  if (change.op === "reorder") return null;
  if (ITEM_TAG.test(change.after)) return STAGE1_REASONS.itemTag;
  return numberProblem(original, change.op === "replace" ? change.before : "", change.after, change.evidenceIds, userEvidence);
}

function structureProblem(draft: Cv, change: Change): string | null {
  if (change.op === "replace") {
    const id = change.targetItemId;
    if (textItems(draft).has(id)) return null;
    if (!allIds(draft).has(id)) return STAGE1_REASONS.unknownTarget;
    const protectedItems = [draft.experience, draft.education, draft.projects, draft.certifications].flat();
    return protectedItems.some((item) => item.id === id) ? STAGE1_REASONS.protectedField : STAGE1_REASONS.notTextItem;
  }
  if (change.op === "add") {
    if (textParentIds(draft).has(change.parentId)) return null;
    return childLists(draft).has(change.parentId) || allIds(draft).has(change.parentId)
      ? STAGE1_REASONS.parentNotText
      : STAGE1_REASONS.unknownParent;
  }
  const list = childLists(draft).get(change.parentId);
  if (list === undefined) return STAGE1_REASONS.unknownParent;
  const current = list.map((item) => item.id).sort();
  const wanted = [...change.orderedItemIds].sort();
  const same = current.length === wanted.length && current.every((id, i) => id === wanted[i]);
  return same ? null : STAGE1_REASONS.notPermutation;
}

function evidenceProblem(original: Cv, draft: Cv, change: Change, userEvidence: UserEvidence[]): string | null {
  if (change.op !== "reorder" && change.evidenceIds.length === 0) return STAGE1_REASONS.noEvidence;
  const known = new Set<string>([...collectItemIds(original), ...userEvidence.map((u) => u.id)]);
  const inDraft = allIds(draft);
  for (const id of change.evidenceIds) {
    if (known.has(id)) continue;
    if (SECTION_ID_PATTERN.test(id) || (LIST_IDS as readonly string[]).includes(id)) {
      return STAGE1_REASONS.sectionEvidence;
    }
    return inDraft.has(id) ? STAGE1_REASONS.addedItemEvidence : STAGE1_REASONS.unknownEvidence;
  }
  return null;
}

function numberProblem(original: Cv, before: string, after: string, evidenceIds: string[], userEvidence: UserEvidence[]): string | null {
  const beforeNumbers = numbersIn(before);
  const afterNumbers = numbersIn(after);
  for (const n of beforeNumbers) if (!afterNumbers.has(n)) return STAGE1_REASONS.numberDropped;
  const texts = itemTexts(original);
  for (const u of userEvidence) texts.set(u.id, u.text);
  const allowed = new Set(beforeNumbers);
  for (const id of evidenceIds) for (const n of numbersIn(texts.get(id) ?? "")) allowed.add(n);
  for (const n of afterNumbers) if (!allowed.has(n)) return STAGE1_REASONS.numberAdded;
  return null;
}
