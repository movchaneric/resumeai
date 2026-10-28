import { applyChanges, bulletParents, childLists, keptChanges, originalBulletIds, textItems, userDrops } from "@resume-ai/shared";
import type { Change, Cv, ItemId } from "@resume-ai/shared";

/**
 * How one Item shows in the CV page:
 * - `plain`: the text as it stands;
 * - `replaced`: `before` struck, `text` (the new words) underlined;
 * - `added`: a new Item;
 * - `removed`: struck (a kept `remove` Change);
 * - `dropped`: struck (the user dropped it);
 * - `skipped`: a proposed addition the user rejected, kept visible so the Change can be selected.
 */
export type MarkKind = "plain" | "replaced" | "added" | "removed" | "dropped" | "skipped";

export interface ItemMark {
  id: string;
  kind: MarkKind;
  /** The text to show; for `removed`, `dropped` and `replaced` the original, and for `replaced` the new words are in `text` and the old in `before`. */
  text: string;
  before?: string;
  /** The Change that touches this Item, if any. */
  changeId?: string;
  /** Whether that Change is kept (accepted or revised), so its marks apply. */
  kept: boolean;
}

export interface ListMarks {
  items: ItemMark[];
  /** A `reorder` Change on this list, with the original order as text. */
  reorder?: { changeId: string; kept: boolean; originalOrder: string[] };
}

export interface CvMarks {
  /** The marks of a list's children (a job's bullets, the skills, an additional section's items), in display order. */
  list: (parentId: string) => ListMarks;
  /** The mark of a single text Item that is in no list (the summary). */
  item: (itemId: string) => ItemMark | undefined;
  /** The Item each Change shows on: its target, or the new Item of an `add` (null for a `reorder`). */
  itemOfChange: (changeId: string) => string | null;
  /** The bullet Items that can take a Drop: bullets of a job, project or education entry (original or added). */
  isBullet: (itemId: string) => boolean;
  /** The IDs of the CV's original bullets. */
  originalBullets: Set<string>;
}

interface Options {
  /** Show proposed additions the user rejected as `skipped` Items. The read-only page leaves them out. */
  includeSkipped?: boolean;
}

const firstKept = (changes: Change[] | undefined): Change | undefined => changes?.find((c) => c.status === "accepted" || c.status === "revised") ?? changes?.[0];
const isKept = (c: Change | undefined): boolean => c !== undefined && (c.status === "accepted" || c.status === "revised");

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * What the CV page draws: the ORIGINAL CV with every Change laid over it. `changes` carry their decision as `status`
 * (`accepted`, `rejected`, `revised`; `proposed` counts as not applied). Kept Changes show their marks; a rejected one
 * shows the original text, still tied to its Change so it can be selected. `drops` are the bullets the user dropped.
 * Pure. The shared `applyChanges` gives the final order and the IDs of added Items; the original gives removed Items.
 */
export function buildCvMarks(original: Cv, changes: Change[], drops: ItemId[] = [], { includeSkipped = true }: Options = {}): CvMarks {
  const dropSet = new Set<string>(drops);
  const kept = keptChanges([...changes, ...userDrops(original, drops)]);
  const keptAdds = kept.filter((c) => c.op === "add");
  const keptWithoutDrops = keptChanges(changes);

  let final = original;
  let addsOnly = original;
  try {
    final = applyChanges(original, kept);
    addsOnly = applyChanges(original, keptAdds);
  } catch {
    // Changes that do not fit the CV cannot be drawn; show the original.
  }

  const originalTexts = textItems(original);
  const finalTexts = textItems(final);
  const originalLists = childLists(original);
  const finalLists = childLists(final);
  const addsOnlyLists = childLists(addsOnly);
  const bulletIds = originalBulletIds(original);

  const bulletItems = new Set<string>([...bulletParents(original), ...bulletParents(final)].flatMap((p) => p.bullets.map((b) => b.id as string)));

  const replaces = new Map<string, Change[]>();
  const removes = new Map<string, Change[]>();
  const reorders = new Map<string, Change[]>();
  const addsByParent = new Map<string, Change[]>();
  const itemByChange = new Map<string, string | null>();
  for (const c of changes) {
    if (c.op === "replace") {
      push(replaces, c.targetItemId, c);
      itemByChange.set(c.id, c.targetItemId);
    } else if (c.op === "remove") {
      push(removes, c.targetItemId, c);
      itemByChange.set(c.id, c.targetItemId);
    } else if (c.op === "reorder") {
      push(reorders, c.parentId, c);
      itemByChange.set(c.id, null);
    } else push(addsByParent, c.parentId, c);
  }

  // The Item each kept `add` became: the n-th new Item of a list is the n-th kept add for that parent.
  const addedItem = new Map<string, string>();
  for (const [parentId, list] of addsOnlyLists) {
    const known = new Set((originalLists.get(parentId) ?? []).map((i) => i.id));
    const fresh = list.filter((i) => !known.has(i.id));
    const adds = (addsByParent.get(parentId) ?? []).filter((c) => keptWithoutDrops.includes(c));
    fresh.forEach((item, n) => {
      const add = adds[n];
      if (add) {
        addedItem.set(add.id, item.id);
        itemByChange.set(add.id, item.id);
      }
    });
  }

  const markFor = (id: string): ItemMark => {
    const inFinal = finalTexts.get(id);
    const inOriginal = originalTexts.get(id);
    const removing = firstKept(removes.get(id));
    if (inOriginal && !inFinal) {
      if (dropSet.has(id)) return { id, kind: "dropped", text: inOriginal.text, kept: true };
      return { id, kind: "removed", text: inOriginal.text, changeId: removing?.id, kept: true };
    }
    if (!inOriginal) {
      const add = [...addedItem].find(([, itemId]) => itemId === id)?.[0];
      return { id, kind: "added", text: inFinal?.text ?? "", changeId: add, kept: true };
    }
    const rewording = firstKept(replaces.get(id));
    if (rewording && isKept(rewording)) return { id, kind: "replaced", text: inFinal?.text ?? inOriginal.text, before: inOriginal.text, changeId: rewording.id, kept: true };
    const other = rewording ?? removing;
    return { id, kind: "plain", text: inOriginal.text, changeId: other?.id, kept: false };
  };

  const listCache = new Map<string, ListMarks>();
  const list = (parentId: string): ListMarks => {
    const cached = listCache.get(parentId);
    if (cached) return cached;
    const before = originalLists.get(parentId) ?? [];
    const after = finalLists.get(parentId) ?? before;
    const merged = after.map((i) => i.id as string);
    const present = new Set(merged);
    // Removed Items keep their place: after the nearest earlier original Item that is still there.
    before.forEach((item, index) => {
      if (present.has(item.id)) return;
      let at = 0;
      for (let k = index - 1; k >= 0; k--) {
        const prev = merged.indexOf(before[k]!.id);
        if (prev >= 0) {
          at = prev + 1;
          break;
        }
      }
      merged.splice(at, 0, item.id);
      present.add(item.id);
    });
    const items = merged.map(markFor);
    if (includeSkipped) {
      for (const c of addsByParent.get(parentId) ?? []) {
        if (isKept(c) || c.op !== "add") continue;
        items.push({ id: `skipped:${c.id}`, kind: "skipped", text: c.after, changeId: c.id, kept: false });
        itemByChange.set(c.id, `skipped:${c.id}`);
      }
    }
    const reorder = firstKept(reorders.get(parentId));
    const result: ListMarks = { items };
    if (reorder) result.reorder = { changeId: reorder.id, kept: isKept(reorder), originalOrder: before.map((i) => originalTexts.get(i.id)?.text ?? "") };
    listCache.set(parentId, result);
    return result;
  };

  // Resolve every list once, so `itemOfChange` knows the Items of skipped additions too.
  for (const parentId of originalLists.keys()) list(parentId);

  return {
    list,
    item: (itemId) => (originalTexts.has(itemId) ? markFor(itemId) : undefined),
    itemOfChange: (changeId) => itemByChange.get(changeId) ?? null,
    isBullet: (itemId) => bulletItems.has(itemId),
    originalBullets: bulletIds,
  };
}
