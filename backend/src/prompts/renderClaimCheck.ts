/**
 * Prompt text for the claim check. The input type is deliberately narrow: a Change's id, its `before` and `after`
 * text, and the text of the cited Evidence Items and User Evidence. There is no field for the Job Description, rationale or Requirements.
 */
export interface ClaimCheckInput {
  id: string;
  /** Empty for an `add`. */
  before: string;
  after: string;
  /** Text of the cited Evidence Items from the original CV. */
  evidence: string[];
  /** The user's own statements (Answers) the Change cites. Trusted as facts; the After text must still rest on them. */
  userEvidence?: string[];
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
        ...(c.userEvidence && c.userEvidence.length > 0
          ? ["The user's own statements (not from the CV):", ...c.userEvidence.map((e) => `- ${e}`)]
          : []),
      ].join("\n"),
    )
    .join("\n\n");
}
