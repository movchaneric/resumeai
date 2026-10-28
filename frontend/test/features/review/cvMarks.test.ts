import { applyDecisions } from "@resume-ai/shared";
import type { ItemId } from "@resume-ai/shared";
import { describe, expect, it } from "vitest";
import { buildCvMarks } from "@/features/review";
import { reviewRunView } from "../../fixtures/runViews";

const run = reviewRunView();
const decide = (decisions: Record<string, "accept" | "reject">) =>
  applyDecisions(
    run.changes,
    run.changes.map((c) => ({ changeId: c.id, decision: decisions[c.id] ?? "accept" })),
  );
const texts = (items: { text: string }[]) => items.map((i) => i.text);

describe("buildCvMarks", () => {
  const marks = buildCvMarks(run.originalCv, decide({}));

  it("marks a kept replace with the old and the new words", () => {
    const b1 = marks.list("exp1").items.find((i) => i.id === "b1");
    expect(b1).toMatchObject({ kind: "replaced", before: "Built an internal tool.", text: "Built an internal tool used by 40 engineers.", changeId: "c1", kept: true });
  });

  it("appends an added Item with the ID the shared applyChanges gives it", () => {
    const added = marks.list("exp1").items.at(-1)!;
    expect(added).toMatchObject({ id: "exp1.b1", kind: "added", text: "Cut the import time in half.", changeId: "c2" });
    expect(marks.itemOfChange("c2")).toBe("exp1.b1");
  });

  it("keeps a removed Item in its place, struck", () => {
    expect(marks.list("exp1").items.map((i) => [i.id, i.kind])).toEqual([
      ["b1", "replaced"],
      ["b2", "replaced"],
      ["b3", "removed"],
      ["exp1.b1", "added"],
    ]);
  });

  it("shows the new order of a reordered list with the original order", () => {
    const skills = marks.list("skills");
    expect(texts(skills.items)).toEqual(["SQL", "Node.js"]);
    expect(skills.reorder).toEqual({ changeId: "c4", kept: true, originalOrder: ["Node.js", "SQL"] });
  });

  it("draws a rejected Change as the original, still tied to its Change", () => {
    const rejected = buildCvMarks(run.originalCv, decide({ c1: "reject", c2: "reject", c3: "reject", c4: "reject" }));
    const items = rejected.list("exp1").items;
    expect(items[0]).toMatchObject({ id: "b1", kind: "plain", text: "Built an internal tool.", changeId: "c1", kept: false });
    expect(items[2]).toMatchObject({ id: "b3", kind: "plain", changeId: "c3", kept: false });
    expect(items.at(-1)).toMatchObject({ kind: "skipped", text: "Cut the import time in half.", changeId: "c2" });
    expect(texts(rejected.list("skills").items)).toEqual(["Node.js", "SQL"]);
    expect(rejected.list("skills").reorder).toMatchObject({ changeId: "c4", kept: false });
  });

  it("leaves skipped additions out when asked", () => {
    const quiet = buildCvMarks(run.originalCv, decide({ c2: "reject" }), [], { includeSkipped: false });
    expect(quiet.list("exp1").items.some((i) => i.kind === "skipped")).toBe(false);
  });

  it("shows a user drop struck", () => {
    const dropped = buildCvMarks(run.originalCv, decide({ c5: "reject" }), ["b2" as ItemId]);
    expect(dropped.list("exp1").items.find((i) => i.id === "b2")).toMatchObject({ kind: "dropped", text: "Wrote reports for the team." });
  });

  it("knows which Items are bullets", () => {
    expect(marks.isBullet("b4")).toBe(true);
    expect(marks.isBullet("exp1.b1")).toBe(true);
    expect(marks.isBullet("s1")).toBe(false);
  });
});
