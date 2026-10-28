import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemId } from "@resume-ai/shared";
import { canDrop, createReviewReducer, initialReviewState, loadReviewState, mayChange, citingRequirements, reviewStorageKey, saveReviewState, toSubmission, decisionCounts } from "@/features/review";
import type { ReviewAction, ReviewState } from "@/features/review";
import { reviewRunView } from "../../fixtures/runViews";

const run = reviewRunView();
const reducer = createReviewReducer(run);
const id = (s: string) => s as ItemId;
const run_ = (actions: ReviewAction[], from: ReviewState = initialReviewState(run)) => actions.reduce(reducer, from);

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("initial state", () => {
  it("accepts every Change, with no drops and nothing reviewed", () => {
    const s = initialReviewState(run);
    expect(s.changeIds).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(Object.values(s.decisions).every((d) => d.decision === "accept")).toBe(true);
    expect(s).toMatchObject({ drops: [], reviewed: [], selectedId: null, undo: [] });
  });
});

describe("reducer", () => {
  it("accept and reject set the decision and mark the Change reviewed", () => {
    const s = run_([{ type: "reject", changeId: "c1" }, { type: "accept", changeId: "c2" }]);
    expect(s.decisions.c1).toEqual({ decision: "reject" });
    expect(s.decisions.c2).toEqual({ decision: "accept" });
    expect(s.reviewed).toEqual(["c1", "c2"]);
  });

  it("ignores an unknown Change", () => {
    const start = initialReviewState(run);
    expect(reducer(start, { type: "reject", changeId: "nope" })).toBe(start);
  });

  it("revise keeps trimmed text, and a reorder keeps its order", () => {
    const s = run_([{ type: "revise", changeId: "c1", after: "  My words.  " }, { type: "revise", changeId: "c4", orderedItemIds: [id("s1"), id("s2")] }]);
    expect(s.decisions.c1).toEqual({ decision: "revise", after: "My words." });
    expect(s.decisions.c4).toEqual({ decision: "revise", orderedItemIds: ["s1", "s2"] });
  });

  it("revise ignores empty text, a remove, and a reorder without an order", () => {
    const start = initialReviewState(run);
    expect(reducer(start, { type: "revise", changeId: "c1", after: "   " })).toBe(start);
    expect(reducer(start, { type: "revise", changeId: "c3", after: "x" })).toBe(start);
    expect(reducer(start, { type: "revise", changeId: "c4" })).toBe(start);
  });

  it("bulk sets the decision for the given Changes, marks them reviewed, and leaves revised ones alone", () => {
    const s = run_([{ type: "revise", changeId: "c1", after: "Mine." }, { type: "bulk", decision: "reject", changeIds: ["c1", "c2", "c5"] }]);
    expect(s.decisions.c1?.decision).toBe("revise");
    expect(s.decisions.c2?.decision).toBe("reject");
    expect(s.decisions.c5?.decision).toBe("reject");
    expect(s.decisions.c3?.decision).toBe("accept");
    expect(s.reviewed).toEqual(expect.arrayContaining(["c1", "c2", "c5"]));
  });

  it("select sets the selection and marks the Change reviewed; null clears it", () => {
    const s = run_([{ type: "select", changeId: "c4" }]);
    expect(s.selectedId).toBe("c4");
    expect(s.reviewed).toEqual(["c4"]);
    expect(reducer(s, { type: "select", changeId: null }).selectedId).toBeNull();
    expect(s.undo).toEqual([]);
  });

  it("drop adds an allowed bullet and undrop removes it", () => {
    const s = run_([{ type: "drop", itemId: id("b2") }, { type: "reject", changeId: "c5" }, { type: "drop", itemId: id("b2") }]);
    expect(s.drops).toEqual(["b2"]);
    expect(reducer(s, { type: "undrop", itemId: id("b2") }).drops).toEqual([]);
  });

  it("drop refuses a bullet the rules refuse, and does not add an undo step", () => {
    const start = initialReviewState(run);
    expect(reducer(start, { type: "drop", itemId: id("b4") })).toBe(start);
  });

  it("an accepted rewording takes back a drop of its bullet", () => {
    const s = run_([{ type: "reject", changeId: "c5" }, { type: "drop", itemId: id("b2") }]);
    expect(s.drops).toEqual(["b2"]);
    expect(reducer(s, { type: "accept", changeId: "c5" }).drops).toEqual([]);
  });

  it("undo restores the decisions and drops one step at a time, and keeps what was reviewed", () => {
    const s = run_([{ type: "reject", changeId: "c1" }, { type: "reject", changeId: "c5" }, { type: "drop", itemId: id("b2") }]);
    expect(s.undo).toHaveLength(3);
    const u1 = reducer(s, { type: "undo" });
    expect(u1.drops).toEqual([]);
    const u2 = reducer(u1, { type: "undo" });
    expect(u2.decisions.c5?.decision).toBe("accept");
    const u3 = reducer(u2, { type: "undo" });
    expect(u3.decisions.c1?.decision).toBe("accept");
    expect(u3.reviewed).toEqual(["c1", "c5"]);
    expect(reducer(u3, { type: "undo" })).toBe(u3);
  });

  it("a bulk action is one undo step", () => {
    const s = run_([{ type: "bulk", decision: "reject", changeIds: ["c1", "c2", "c3"] }]);
    expect(s.undo).toHaveLength(1);
    expect(Object.values(reducer(s, { type: "undo" }).decisions).every((d) => d.decision === "accept")).toBe(true);
  });

  it("repeating a decision adds no undo step", () => {
    const s = run_([{ type: "accept", changeId: "c1" }]);
    expect(s.undo).toEqual([]);
    expect(s.reviewed).toEqual(["c1"]);
  });
});

describe("toSubmission and counts", () => {
  it("lists a decision per Change in the Run's order, with text only on revisions", () => {
    const s = run_([
      { type: "reject", changeId: "c2" },
      { type: "revise", changeId: "c1", after: "Mine." },
      { type: "revise", changeId: "c4", orderedItemIds: [id("s1"), id("s2")] },
      { type: "reject", changeId: "c5" },
      { type: "drop", itemId: id("b2") },
    ]);
    expect(toSubmission(s)).toEqual({
      decisions: [
        { changeId: "c1", decision: "revise", after: "Mine." },
        { changeId: "c2", decision: "reject" },
        { changeId: "c3", decision: "accept" },
        { changeId: "c4", decision: "revise", orderedItemIds: ["s1", "s2"] },
        { changeId: "c5", decision: "reject" },
      ],
      drops: ["b2"],
    });
    expect(decisionCounts(s)).toEqual({ accepted: 1, edited: 2, rejected: 2, dropped: 1 });
  });
});

describe("canDrop (the shared drop rules)", () => {
  const start = initialReviewState(run);
  it("allows a bullet with no kept Change", () => {
    expect(canDrop(run, run_([{ type: "reject", changeId: "c5" }]), id("b2"))).toEqual({ ok: true });
  });
  it("refuses a bullet with a kept rewording, naming the Change", () => {
    const r = canDrop(run, start, id("b1"));
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.reason).toContain("c1");
  });
  it("refuses a bullet whose removal is accepted", () => {
    const r = canDrop(run, start, id("b3"));
    expect(r.ok === false && r.reason).toContain("already removes");
    expect(canDrop(run, run_([{ type: "reject", changeId: "c3" }]), id("b3"))).toEqual({ ok: true });
  });
  it("refuses a job's last bullet", () => {
    const r = canDrop(run, start, id("b4"));
    expect(r.ok === false && r.reason).toContain("at least one");
  });
  it("refuses a bullet already dropped and one that is not an original bullet", () => {
    const s = run_([{ type: "reject", changeId: "c5" }, { type: "drop", itemId: id("b2") }]);
    expect(canDrop(run, s, id("b2")).ok).toBe(false);
    expect(canDrop(run, start, id("s1")).ok).toBe(false);
  });
  it("counts the drops already made toward a job's last bullet", () => {
    const s = run_([{ type: "reject", changeId: "c5" }, { type: "reject", changeId: "c1" }, { type: "reject", changeId: "c3" }, { type: "reject", changeId: "c2" }, { type: "drop", itemId: id("b1") }, { type: "drop", itemId: id("b2") }]);
    expect(s.drops).toEqual(["b1", "b2"]);
    expect(canDrop(run, s, id("b3")).ok).toBe(false);
  });
});

describe("mayChange (the three sets of final_rejudge)", () => {
  const may = (actions: ReviewAction[]) => [...mayChange(run_(actions), run)].sort();

  it("is empty when every Change is accepted and nothing is dropped", () => {
    expect(may([])).toEqual([]);
  });

  it("set 1: a Requirement listed by a rejected or revised Change", () => {
    expect(may([{ type: "reject", changeId: "c4" }])).toEqual(["r3"]);
    expect(may([{ type: "revise", changeId: "c2", after: "Mine." }])).toEqual(["r2"]);
  });

  it("set 1: a Change listing nothing marks nothing", () => {
    expect(may([{ type: "reject", changeId: "c3" }])).toEqual([]);
  });

  it("set 2: a Requirement whose Evidence cites an Item an undone replace or remove touched", () => {
    // c5 targets b2, which r1 cites (c5 lists r1 too).
    expect(may([{ type: "reject", changeId: "c5" }])).toEqual(["r1"]);
  });

  it("set 2: a rejected remove touches its target", () => {
    const view = reviewRunView({
      requirements: run.requirements.map((r) => (r.id === "r4" ? { ...r, after: { ...r.after, evidenceIds: ["b3"] } } : r)),
    });
    expect([...mayChange(run_([{ type: "reject", changeId: "c3" }]), view)]).toEqual(["r4"]);
  });

  it("set 2: an accepted Change marks nothing, and an undone add or reorder touches no Item", () => {
    const view = reviewRunView({
      requirements: run.requirements.map((r) => (r.id === "r4" ? { ...r, after: { ...r.after, evidenceIds: ["s2"] } } : r)),
    });
    expect([...mayChange(run_([{ type: "reject", changeId: "c4" }]), view)]).toEqual(["r3"]);
  });

  it("set 3: a Requirement whose Evidence cites a dropped bullet (r4 is listed by no Change)", () => {
    const view = reviewRunView({
      requirements: run.requirements.map((r) => (r.id === "r4" ? { ...r, after: { ...r.after, evidenceIds: ["b3"] } } : r)),
    });
    const s = run_([{ type: "reject", changeId: "c3" }, { type: "drop", itemId: id("b3") }], initialReviewState(view));
    expect([...mayChange(s, view)].sort()).toEqual(["r4"]);
  });

  it("set 3: dropping an uncited bullet marks nothing", () => {
    expect(may([{ type: "reject", changeId: "c5" }, { type: "drop", itemId: id("b2") }, { type: "accept", changeId: "c5" }])).toEqual([]);
    expect(may([{ type: "reject", changeId: "c3" }, { type: "drop", itemId: id("b3") }])).toEqual([]);
  });

  it("a Requirement none of the sets reach is not marked", () => {
    expect(may([{ type: "reject", changeId: "c1" }, { type: "reject", changeId: "c2" }])).not.toContain("r4");
  });
});

describe("citingRequirements", () => {
  it("returns the rows whose final Evidence cites the Item", () => {
    expect(citingRequirements(run, "b2").map((r) => r.id)).toEqual(["r1"]);
    expect(citingRequirements(run, "b3")).toEqual([]);
  });
});

describe("persistence", () => {
  it("saves per Run without the undo stack, and restores the same state", () => {
    const s = run_([{ type: "reject", changeId: "c5" }, { type: "drop", itemId: id("b2") }, { type: "select", changeId: "c4" }]);
    saveReviewState(s);
    const raw = JSON.parse(window.sessionStorage.getItem(reviewStorageKey(run.id))!);
    expect(raw.undo).toBeUndefined();
    const restored = loadReviewState(run)!;
    expect(restored).toEqual({ ...s, undo: [] });
  });

  it("restores nothing when the saved Change IDs are not the Run's", () => {
    saveReviewState(run_([{ type: "reject", changeId: "c1" }]));
    const other = reviewRunView({ changes: run.changes.slice(0, 4) });
    expect(loadReviewState(other)).toBeNull();
  });

  it("restores nothing from garbage or a missing key", () => {
    expect(loadReviewState(run)).toBeNull();
    window.sessionStorage.setItem(reviewStorageKey(run.id), "{not json");
    expect(loadReviewState(run)).toBeNull();
    window.sessionStorage.setItem(reviewStorageKey(run.id), JSON.stringify({ v: 2 }));
    expect(loadReviewState(run)).toBeNull();
  });

  it("drops a saved drop the rules no longer allow", () => {
    const s = run_([{ type: "reject", changeId: "c5" }, { type: "drop", itemId: id("b2") }]);
    saveReviewState({ ...s, decisions: { ...s.decisions, c5: { decision: "accept" } } });
    expect(loadReviewState(run)!.drops).toEqual([]);
  });

  it("keeps working when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => saveReviewState(initialReviewState(run))).not.toThrow();
    expect(loadReviewState(run)).toBeNull();
  });
});
