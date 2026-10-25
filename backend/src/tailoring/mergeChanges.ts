import type { Change, Cv } from "@resume-ai/shared";
import { applyChanges } from "@/tailoring/applyChanges.js";
import { allIds } from "@/tailoring/cvItems.js";

const union = <T>(a: T[], b: T[]): T[] => [...new Set([...a, ...b])];

/** The Item ID each kept `add` produces, by Change ID. Adds are applied in array order, so this is stable. */
function addedItemIds(original: Cv, kept: Change[]): Map<string, string> {
  const result = new Map<string, string>();
  const adds: Change[] = [];
  let seen = allIds(original);
  for (const change of kept) {
    if (change.op !== "add") continue;
    adds.push(change);
    const now = allIds(applyChanges(original, adds));
    const created = [...now].find((id) => !seen.has(id));
    if (created !== undefined) result.set(change.id, created);
    seen = now;
  }
  return result;
}

/**
 * Folds the Changes a kept round produced into the Changes kept so far, so each Item has one Change.
 * - A Change on an Item that already has one replaces it but keeps the earlier ID and `before` (the original text),
 *   and merges the Requirement IDs.
 * - One reorder per list: the latest wins and keeps the earlier ID.
 * - A `replace` of an Item an earlier round added becomes a new version of that `add` (same parent and ID, new text).
 * A replaced Change stays at its old position, so the IDs of added Items never shift. Pure; inputs are not mutated.
 */
export function mergeRoundIntoChanges(original: Cv, kept: Change[], round: Change[]): Change[] {
  const merged: Change[] = structuredClone(kept);
  const added = addedItemIds(original, kept);

  for (const incoming of round) {
    if (incoming.op === "add") {
      merged.push(incoming);
      continue;
    }
    const index = merged.findIndex((existing) => {
      if (incoming.op === "reorder") return existing.op === "reorder" && existing.parentId === incoming.parentId;
      return (
        (existing.op === "replace" && existing.targetItemId === incoming.targetItemId) ||
        (existing.op === "add" && added.get(existing.id) === incoming.targetItemId)
      );
    });
    const existing = index === -1 ? undefined : merged[index]!;
    if (existing === undefined) {
      merged.push(incoming);
    } else if (incoming.op === "reorder") {
      merged[index] = { ...incoming, id: existing.id, requirementIds: union(existing.requirementIds, incoming.requirementIds) };
    } else if (existing.op === "add") {
      merged[index] = { ...existing, after: incoming.after, rationale: incoming.rationale, evidenceIds: incoming.evidenceIds, requirementIds: union(existing.requirementIds, incoming.requirementIds), status: incoming.status };
    } else if (existing.op === "replace") {
      merged[index] = { ...incoming, id: existing.id, before: existing.before, requirementIds: union(existing.requirementIds, incoming.requirementIds) };
    }
  }
  return merged;
}
