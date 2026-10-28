export type Choice = "yes" | "no";
export interface QuestionDraft {
  choice: Choice | null;
  text: string;
}
export interface Draft {
  index: number;
  answers: Record<string, QuestionDraft>;
}

const keyFor = (runId: string) => `resume-ai:draft:${runId}`;

/** The draft of a Run from `sessionStorage`; anything missing, broken or for other Questions is dropped. */
export function loadDraft(runId: string, questionIds: string[]): Draft {
  const empty: Draft = { index: 0, answers: {} };
  try {
    const raw = window.sessionStorage.getItem(keyFor(runId));
    if (!raw) return empty;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return empty;
    const { index, answers } = data as { index?: unknown; answers?: unknown };
    const kept: Record<string, QuestionDraft> = {};
    if (typeof answers === "object" && answers !== null) {
      for (const id of questionIds) {
        const a = (answers as Record<string, unknown>)[id] as Partial<QuestionDraft> | undefined;
        if (a && typeof a.text === "string" && (a.choice === "yes" || a.choice === "no" || a.choice === null)) kept[id] = { choice: a.choice, text: a.text };
      }
    }
    const i = typeof index === "number" && Number.isInteger(index) ? Math.min(Math.max(index, 0), questionIds.length - 1) : 0;
    return { index: i, answers: kept };
  } catch {
    return empty;
  }
}

export function saveDraft(runId: string, draft: Draft): void {
  try {
    window.sessionStorage.setItem(keyFor(runId), JSON.stringify(draft));
  } catch {
    // Storage is unavailable: the draft lives only in memory.
  }
}

export function clearDraft(runId: string): void {
  try {
    window.sessionStorage.removeItem(keyFor(runId));
  } catch {
    // Nothing to clear.
  }
}
