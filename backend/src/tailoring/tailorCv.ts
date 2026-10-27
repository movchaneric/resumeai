import { z } from "zod";
import { ChangeSchema, LIST_IDS } from "@resume-ai/shared";
import type { Change, Coverage, Cv, Requirement, RequirementId, UserEvidence } from "@resume-ai/shared";
import { FLOOR_STEP, fitOf } from "@/export/index.js";
import { LlmSchemaError, type LlmClient, type LlmMessage } from "@/llm/llmClient.js";
import { renderTailorInput, type TailorFit, type TailorRejection } from "@/prompts/renderTailor.js";
import { TailorError } from "@/tailoring/tailorErrors.js";
import { withSpan } from "@/utils/spans.js";

export const TAILOR_SYSTEM_PROMPT = `You tailor a CV to a job by proposing Changes to its Items.

Rules:
- Target the Requirements that are not met, in the order listed: those with User Evidence first, then must-haves. The met Requirements are context: do not break them.
- Propose a Change only where the CV or the User Evidence already holds Evidence for the Requirement. If there is none, propose nothing. An empty list is a good answer.
- A Change's text may reword the Evidence and use the job's wording, but states nothing the Evidence does not state: no new technologies, numbers, scope, roles or achievements. Do not add words such as "designed", "REST" or "API" unless the Evidence says them.
- Never append qualities, adjectives, soft skills, ways of working, collaboration, ownership, independence or impact that the Evidence does not state, even when the job asks for them. If a Requirement can only be met by adding such a claim, propose nothing for it.
- Keep every number and date exactly as it is. Never change dates, companies, titles or degrees.
- Allowed:
  - Replace the Item's own words with the job's term for the same thing.
  - Make explicit a technology or fact that a cited Item already states.
  - Reorder a list so relevant Items come first.
  - Rewrite the summary using only facts from cited Items.
  - Add a skill only when a cited experience, project or education Item shows it in use.
- The Tailored CV must fit one page. Prefer "replace" (rewording) over "add": each added Item costs space. The page status of the draft is given in the input.
- Never remove content. The operations are:
  - "replace": new text for one text Item (a bullet, a skill, the summary or an item in another section). Set targetItemId and text.
  - "add": a new text Item under a job, a project, a section, or a top-level list (${LIST_IDS.join(", ")}). Set parentId and text.
  - "reorder": the same Items in a new order under one parent. Set parentId and orderedItemIds, listing every Item once.
- User Evidence is what the user told us about their own experience, listed as [ueN] (for reqM) text. Treat it as true, but state no more than it says. A Change may cite ue IDs as Evidence, alone or with CV Items. An "add" Change built on User Evidence is allowed: put the new Item under the job (or project) the statement names.
- Cite Item IDs exactly as shown in brackets in the CV, for example exp1.b2, or User Evidence IDs such as ue1. Never invent an ID. Every Change cites at least one Evidence ID and lists at least one Requirement ID it addresses.
- At most one Change per Item and one reorder per list.
- Give a short rationale for each Change.
- Do not propose again anything listed under "Rejected earlier".
- Fields that do not apply to the operation are null.

Rejected (made up): Evidence [exp1.b2] "Built the billing service in Go" must not become "Built the billing service in Go, ensuring attention to detail". The Evidence never says it, even if the job asks for it.
Accepted (made up): User Evidence [ue1] (for req2) "Ran a small cluster at Acme" under job exp1. Add to exp1 the Item "Operated a small cluster at Acme", citing ue1.
Accepted (made up): the job asks for "Golang" and [exp1.b2] says "Built the billing service in Go". Replace it with "Built the billing service in Golang".`;

const RETRY_INSTRUCTION =
  "Your previous answer had problems:\n{issues}\n\nAnswer again with a corrected list of Changes that follows the rules and the schema exactly.";

const CALL_NAME = "tailor";

/** Flat on purpose (nullable fields instead of a union) so strict structured output stays simple. */
const TailorAnswerSchema = z.object({
  changes: z.array(
    z.object({
      op: z.enum(["replace", "add", "reorder"]),
      targetItemId: z.string().nullable().describe("replace only: the Item to reword"),
      parentId: z.string().nullable().describe("add and reorder only: the job, project, section or top-level list"),
      text: z.string().nullable().describe("replace and add only: the new text"),
      orderedItemIds: z.string().array().nullable().describe("reorder only: all Items under the parent in the new order"),
      evidenceIds: z.string().array().describe("Item IDs exactly as shown in brackets"),
      requirementIds: z.string().array(),
      rationale: z.string(),
    }),
  ),
});
type TailorAnswer = z.infer<typeof TailorAnswerSchema>;
type ModelChange = TailorAnswer["changes"][number];

export type TailorInput = {
  /** The CV before any Change: the source of every `before` text. */
  originalCv: Cv;
  /** The original plus the validated Changes so far: what the model sees. */
  draftCv: Cv;
  requirements: Requirement[];
  /** The current verdict for every Requirement. */
  coverage: Coverage[];
  rejections: TailorRejection[];
  userEvidence?: UserEvidence[];
  confirmedGaps?: RequirementId[];
  /** 1-based; used for Change IDs (`r<round>.c<n>`) and the span. */
  round: number;
};

/** Text of every free-text Item of the CV, by ID. */
function textItems(cv: Cv): Map<string, string> {
  const map = new Map<string, string>();
  if (cv.summary) map.set(cv.summary.id, cv.summary.text);
  for (const group of [cv.experience, cv.education, cv.projects]) {
    for (const item of group) for (const bullet of item.bullets) map.set(bullet.id, bullet.text);
  }
  for (const skill of cv.skills) map.set(skill.id, skill.text);
  for (const section of cv.additionalSections) for (const item of section.items) map.set(item.id, item.text);
  return map;
}

/** Shape problems that warrant a retry, as readable lines. */
function shapeIssues(changes: ModelChange[], requirements: Requirement[]): string[] {
  const issues: string[] = [];
  const known = new Set<string>(requirements.map((r) => r.id));
  const seen = new Map<string, number>();

  changes.forEach((c, i) => {
    const label = `change ${i + 1} (${c.op})`;
    if (c.evidenceIds.length === 0) issues.push(`${label}: cites no Evidence`);
    if (c.requirementIds.length === 0) issues.push(`${label}: lists no Requirement`);
    for (const id of c.requirementIds) {
      if (!known.has(id)) issues.push(`${label}: ${id} is not a Requirement in the list`);
    }
    if (c.rationale.trim() === "") issues.push(`${label}: has an empty rationale`);

    if (c.op === "replace") {
      if (c.targetItemId === null) issues.push(`${label}: needs a targetItemId`);
      if (c.text === null || c.text.trim() === "") issues.push(`${label}: needs text`);
    } else if (c.op === "add") {
      if (c.parentId === null) issues.push(`${label}: needs a parentId`);
      if (c.text === null || c.text.trim() === "") issues.push(`${label}: needs text`);
    } else {
      if (c.parentId === null) issues.push(`${label}: needs a parentId`);
      if (c.orderedItemIds === null || c.orderedItemIds.length === 0) issues.push(`${label}: needs orderedItemIds`);
    }

    // One Change per Item and one reorder per list; several adds under one parent are fine.
    const key = c.op === "replace" ? `replace:${c.targetItemId}` : c.op === "reorder" ? `reorder:${c.parentId}` : null;
    if (key !== null) {
      const first = seen.get(key);
      if (first === undefined) seen.set(key, i + 1);
      else {
        const target = c.op === "replace" ? c.targetItemId : c.parentId;
        issues.push(`${label}: ${target} already has a ${c.op} in change ${first}; propose one per ${c.op === "replace" ? "Item" : "list"}`);
      }
    }
  });
  return issues;
}

/** Only call after `shapeIssues` returned nothing: the fields each op needs are then non-null. */
function toChanges(changes: ModelChange[], originalCv: Cv, round: number): Change[] {
  const original = textItems(originalCv);
  return changes.map((c, i) => {
    const common = {
      id: `r${round}.c${i + 1}`,
      rationale: c.rationale,
      evidenceIds: c.evidenceIds,
      requirementIds: c.requirementIds,
      status: "proposed" as const,
    };
    switch (c.op) {
      case "replace":
        // An Item added in an earlier round has no original text; the caller folds that Change into the `add`.
        return ChangeSchema.parse({ ...common, op: "replace", targetItemId: c.targetItemId, before: original.get(c.targetItemId!) ?? "", after: c.text });
      case "add":
        return ChangeSchema.parse({ ...common, op: "add", parentId: c.parentId, after: c.text });
      case "reorder":
        return ChangeSchema.parse({ ...common, op: "reorder", parentId: c.parentId, orderedItemIds: c.orderedItemIds });
    }
  });
}

const asLines = (issues: string[]) => issues.map((i) => `- ${i}`).join("\n");

/** One tailoring round's proposal. Throws `TailorError` after the retry; `LlmUnavailableError` passes through unretried. */
export async function tailorCv(llm: LlmClient, input: TailorInput): Promise<{ changes: Change[]; retries: number }> {
  return withSpan(CALL_NAME, async (span) => {
    span.setAttribute("round", input.round);
    const fit = await fitOf(input.draftCv);
    const tailorFit: TailorFit = fit.fits ? { fits: true, step: fit.step + 1, steps: FLOOR_STEP + 1 } : fit;
    const messages: LlmMessage[] = [
      { role: "system", content: TAILOR_SYSTEM_PROMPT },
      {
        role: "user",
        content: renderTailorInput({
          cv: input.draftCv,
          requirements: input.requirements,
          coverage: input.coverage,
          rejections: input.rejections,
          userEvidence: input.userEvidence,
          confirmedGaps: input.confirmedGaps,
          fit: tailorFit,
        }),
      },
    ];

    const attempt = async (msgs: LlmMessage[]): Promise<{ answer: TailorAnswer } | { issues: string[] }> => {
      try {
        const answer = await llm.structured(TailorAnswerSchema, msgs, { name: CALL_NAME });
        const issues = shapeIssues(answer.changes, input.requirements);
        return issues.length === 0 ? { answer } : { issues };
      } catch (error) {
        if (error instanceof LlmSchemaError) return { issues: error.issues };
        throw error;
      }
    };

    span.setAttribute("tailor.retries", 0);
    let result = await attempt(messages);
    let retries = 0;
    if ("issues" in result) {
      retries = 1;
      span.setAttribute("tailor.retries", 1);
      result = await attempt([
        ...messages,
        { role: "user", content: RETRY_INSTRUCTION.replace("{issues}", asLines(result.issues)) },
      ]);
      if ("issues" in result) throw new TailorError("The model did not return valid Changes", result.issues);
    }

    const changes = toChanges(result.answer.changes, input.originalCv, input.round);
    span.setAttribute("tailor.changes_proposed", changes.length);
    return { changes, retries };
  });
}
