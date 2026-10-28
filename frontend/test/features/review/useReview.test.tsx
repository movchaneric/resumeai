import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { reviewStorageKey, useReview } from "@/features/review";
import { reviewRunView } from "../../fixtures/runViews";

const run = reviewRunView();

beforeEach(() => window.sessionStorage.clear());

describe("useReview", () => {
  it("wires the state, the rules and the fit together", () => {
    const { result } = renderHook(() => useReview(run));
    expect(result.current.fit.fit).toEqual(run.fit);
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.dispatch({ type: "reject", changeId: "c4" }));
    expect(result.current.canUndo).toBe(true);
    expect([...result.current.mayChange]).toEqual(["r3"]);
    expect(result.current.toSubmission().decisions[3]).toEqual({ changeId: "c4", decision: "reject" });
    expect(result.current.counts).toMatchObject({ accepted: 4, rejected: 1 });
    expect(result.current.canDrop("b1" as never).ok).toBe(false);
  });

  it("saves to sessionStorage and a new mount restores it, without the undo stack", () => {
    const first = renderHook(() => useReview(run));
    act(() => first.result.current.dispatch({ type: "reject", changeId: "c1" }));
    expect(window.sessionStorage.getItem(reviewStorageKey(run.id))).toContain('"reject"');
    first.unmount();
    const second = renderHook(() => useReview(run));
    expect(second.result.current.state.decisions.c1?.decision).toBe("reject");
    expect(second.result.current.canUndo).toBe(false);
  });
});
