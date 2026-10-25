/**
 * Prompt text for the claim check. The input type is deliberately narrow: a Change's id, its `before` and `after`
 * text, and the text of the cited Evidence Items. There is no field for the Job Description, rationale or Requirements.
 */
export interface ClaimCheckInput {
  id: string;
  /** Empty for an `add`. */
  before: string;
  after: string;
  /** Text of the cited Evidence Items from the original CV. */
  evidence: string[];
}

export function renderClaimCheck(changes: ClaimCheckInput[]): string {
  return changes
    .map((c) =>
      [
        `[${c.id}]`,
        `Before: ${c.before === "" ? "(none, new Item)" : c.before}`,
        `After: ${c.after}`,
        "Evidence:",
        ...c.evidence.map((e) => `- ${e}`),
      ].join("\n"),
    )
    .join("\n\n");
}
