import { dropProblem } from "@resume-ai/shared";
import type { ItemId } from "@resume-ai/shared";
import { describe, expect, it } from "vitest";
import { applyDecisions } from "@resume-ai/shared";
import { explainDrop } from "@/features/review";
import { reviewRunView } from "../../fixtures/runViews";

const run = reviewRunView();
const drop = (...ids: string[]) => dropProblem(run.originalCv, run.changes, applyDecisions(run.changes, run.changes.map((c) => ({ changeId: c.id, decision: "accept" as const }))), ids as ItemId[]);

describe("explainDrop", () => {
  it.each([
    ["a bullet dropped twice", () => drop("b4", "b4"), "duplicate", "You already dropped this bullet."],
    ["a bullet the tailor added", () => dropProblem(run.originalCv, run.changes, run.changes, ["exp1.b1" as ItemId]), "added", "Reject its addition to remove it."],
    ["an Item that is not a bullet", () => drop("s1"), "not_bullet", "Only a bullet under a job, project or education entry can be dropped."],
    ["a bullet an accepted removal already takes out", () => drop("b3"), "removed", "Already removed by an accepted Change."],
    ["a bullet with a kept rewording", () => drop("b1"), "reworded", "Reject its rewording to drop it."],
    ["a job's last bullet", () => drop("b4"), "last", "Each job keeps at least one bullet."],
  ])("maps the shared message for %s", (_name, reason, kind, message) => {
    const text = reason();
    expect(text, "the shared rule gave a reason").not.toBeNull();
    expect(explainDrop(text!)).toEqual({ kind, message });
  });

  it("falls back to the raw reason when it does not know it", () => {
    expect(explainDrop("Something new went wrong.")).toEqual({ kind: "other", message: "Something new went wrong." });
  });
});
