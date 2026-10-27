import { ItemIdSchema } from "@resume-ai/shared";
import type { Change, Cv } from "@resume-ai/shared";
import { SECTION_ID_PATTERN, allIds, bulletParents, childLists, textItems, textParentIds } from "@/tailoring/cvItems.js";

/** ID prefix for a new Item under a parent: `skill`, `exp1.b`, `sec1.i`. Matches `assignCvIds`. */
function newIdPrefix(parentId: string): string {
  if (parentId === "skills") return "skill";
  return SECTION_ID_PATTERN.test(parentId) ? `${parentId}.i` : `${parentId}.b`;
}

/**
 * The draft CV: the original plus the validated Changes. Pure; the input is never mutated.
 * Order: all `add`s (in array order, so the same Changes always give the same IDs), then `replace`s
 * (which may target an added Item), then `reorder`s (which may list added Items), then `remove`s.
 * Removes go last so that dropping a bullet never changes the number a later `add` gets: an added Item's ID is the same
 * with or without the removes.
 * A new Item's number is one past the highest in its list and skips any ID already in use.
 * Throws when a Change does not fit the CV: pass only Changes that stage 1 accepted.
 */
export function applyChanges(original: Cv, changes: Change[]): Cv {
  const draft = structuredClone(original);
  const used = allIds(draft);

  for (const change of changes) {
    if (change.op !== "add") continue;
    const list = childLists(draft).get(change.parentId) as { id: string; text?: string }[] | undefined;
    if (list === undefined || !textParentIds(draft).has(change.parentId)) {
      throw new Error(`Cannot add to ${change.parentId}: not a parent of text Items`);
    }
    const prefix = newIdPrefix(change.parentId);
    let next =
      Math.max(
        0,
        ...list.filter((item) => item.id.startsWith(prefix)).map((item) => Number(item.id.slice(prefix.length)) || 0),
      ) + 1;
    while (used.has(`${prefix}${next}`)) next += 1;
    const id = `${prefix}${next}`;
    used.add(id);
    list.push({ id: ItemIdSchema.parse(id), text: change.after });
  }

  const texts = textItems(draft);
  for (const change of changes) {
    if (change.op !== "replace") continue;
    const target = texts.get(change.targetItemId);
    if (target === undefined) throw new Error(`Cannot replace ${change.targetItemId}: not a text Item`);
    target.text = change.after;
  }

  for (const change of changes) {
    if (change.op !== "reorder") continue;
    const list = childLists(draft).get(change.parentId);
    if (list === undefined) throw new Error(`Cannot reorder ${change.parentId}: no such list`);
    const byId = new Map(list.map((item) => [item.id, item]));
    const ordered = change.orderedItemIds.flatMap((id) => {
      const item = byId.get(id);
      byId.delete(id);
      return item === undefined ? [] : [item];
    });
    // Items the Change did not list keep their place at the end, so nothing is lost.
    list.splice(0, list.length, ...ordered, ...byId.values());
  }

  for (const change of changes) {
    if (change.op !== "remove") continue;
    const parent = bulletParentOf(draft, change.targetItemId);
    if (parent === undefined) throw new Error(`Cannot remove ${change.targetItemId}: not a bullet`);
    parent.bullets.splice(parent.bullets.findIndex((b) => b.id === change.targetItemId), 1);
  }
  return draft;
}

/** The job, project or education entry that holds this bullet. */
function bulletParentOf(cv: Cv, bulletId: string) {
  return bulletParents(cv).find((p) => p.bullets.some((b) => b.id === bulletId));
}
