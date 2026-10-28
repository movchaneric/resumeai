import { act, renderHook } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewFit, ReviewSubmission } from "@resume-ai/shared";
import { PREVIEW_DEBOUNCE_MS, createReviewReducer, initialReviewState, invalidReviewTarget, useFitPreview } from "@/features/review";
import type { ReviewAction, ReviewState } from "@/features/review";
import { reviewRunView } from "../../fixtures/runViews";
import { server } from "../../helpers/server";

const run = reviewRunView();
const reducer = createReviewReducer(run);
const URL = `/api/runs/${run.id}/review/preview`;
const over: ReviewFit = { fits: false, overByLines: 3, fittable: true };
const fitsAt2: ReviewFit = { fits: true, step: 2, fittable: true };

/** The hook plus a way to send actions to a state it follows. */
function setup() {
  let state: ReviewState = initialReviewState(run);
  const hook = renderHook(({ s }) => useFitPreview(run, s), { initialProps: { s: state } });
  const send = (...actions: ReviewAction[]) => {
    state = actions.reduce(reducer, state);
    hook.rerender({ s: state });
  };
  return { ...hook, send };
}

/** Moves the clock, then lets the pending request settle on the real event loop. */
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
afterEach(() => vi.useRealTimers());

describe("useFitPreview", () => {
  it("starts from the view's fit and makes no call", async () => {
    const calls = vi.fn();
    server.use(http.post(URL, () => (calls(), HttpResponse.json(over))));
    const { result } = setup();
    await tick(5000);
    expect(result.current).toMatchObject({ fit: run.fit, checking: false, error: null });
    expect(calls).not.toHaveBeenCalled();
  });

  it("debounces 600ms, then sends the full submission and shows the answer", async () => {
    const bodies: ReviewSubmission[] = [];
    server.use(http.post(URL, async ({ request }) => (bodies.push((await request.json()) as ReviewSubmission), HttpResponse.json(over))));
    const { result, send } = setup();
    send({ type: "reject", changeId: "c2" });
    expect(result.current.checking).toBe(true);
    await tick(PREVIEW_DEBOUNCE_MS - 1);
    expect(bodies).toHaveLength(0);
    await tick(1);
    await vi.waitFor(() => expect(result.current.fit).toEqual(over));
    expect(result.current.checking).toBe(false);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.decisions).toHaveLength(5);
    expect(bodies[0]!.decisions[1]).toEqual({ changeId: "c2", decision: "reject" });
  });

  it("a quick second change restarts the wait and sends one request", async () => {
    const bodies: ReviewSubmission[] = [];
    server.use(http.post(URL, async ({ request }) => (bodies.push((await request.json()) as ReviewSubmission), HttpResponse.json(over))));
    const { send } = setup();
    send({ type: "reject", changeId: "c2" });
    await tick(400);
    send({ type: "reject", changeId: "c1" });
    await tick(400);
    expect(bodies).toHaveLength(0);
    await tick(200);
    await vi.waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.decisions.map((d) => d.decision)).toEqual(["reject", "reject", "accept", "accept", "accept"]);
  });

  it("aborts the request in flight when a newer change starts, and never shows the abort", async () => {
    let aborted = 0;
    let started = 0;
    server.use(
      http.post(URL, async ({ request }) => {
        started++;
        if (started === 1) {
          // Stays open until the client aborts.
          await new Promise<void>((resolve) => request.signal.addEventListener("abort", () => (aborted++, resolve())));
          return HttpResponse.json(over);
        }
        return HttpResponse.json(fitsAt2);
      }),
    );
    const { result, send } = setup();
    send({ type: "reject", changeId: "c2" });
    await tick(PREVIEW_DEBOUNCE_MS);
    await vi.waitFor(() => expect(started).toBe(1));
    send({ type: "reject", changeId: "c1" });
    await vi.waitFor(() => expect(aborted).toBe(1));
    expect(result.current.error).toBeNull();
    await tick(PREVIEW_DEBOUNCE_MS);
    await vi.waitFor(() => expect(result.current.fit).toEqual(fitsAt2));
    expect(result.current.error).toBeNull();
    expect(started).toBe(2);
  });

  it("returns to the view's fit with no call when the choices match the start again", async () => {
    const calls = vi.fn();
    server.use(http.post(URL, () => (calls(), HttpResponse.json(over))));
    const { result, send } = setup();
    send({ type: "reject", changeId: "c2" });
    await tick(PREVIEW_DEBOUNCE_MS);
    await vi.waitFor(() => expect(result.current.fit).toEqual(over));
    send({ type: "undo" });
    expect(result.current).toMatchObject({ fit: run.fit, checking: false });
    await tick(5000);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("maps a 400 INVALID_REVIEW to the Change the message names", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ code: "INVALID_REVIEW", message: "Decision for c5: the text is not allowed." }, { status: 400 })));
    const { result, send } = setup();
    send({ type: "revise", changeId: "c5", after: "Bad words." });
    await tick(PREVIEW_DEBOUNCE_MS);
    await vi.waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toEqual({ kind: "invalid", message: "Decision for c5: the text is not allowed.", changeId: "c5", itemId: null });
    expect(result.current.checking).toBe(false);
    expect(result.current.fit).toEqual(run.fit);
  });

  it("maps a drop message to the Item and the Change it names", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ code: "INVALID_REVIEW", message: "Drop b2: reject its Change c5 to drop it." }, { status: 400 })));
    const { result, send } = setup();
    send({ type: "reject", changeId: "c5" }, { type: "drop", itemId: "b2" as never });
    await tick(PREVIEW_DEBOUNCE_MS);
    await vi.waitFor(() => expect(result.current.error?.kind).toBe("invalid"));
    expect(result.current.error).toMatchObject({ changeId: "c5", itemId: "b2" });
  });

  it("shows a network error, and Retry calls again at once and clears it", async () => {
    let fail = true;
    server.use(http.post(URL, () => (fail ? HttpResponse.error() : HttpResponse.json(over))));
    const { result, send } = setup();
    send({ type: "reject", changeId: "c2" });
    await tick(PREVIEW_DEBOUNCE_MS);
    await vi.waitFor(() => expect(result.current.error?.kind).toBe("unreachable"));
    fail = false;
    act(() => result.current.retry());
    await tick(0);
    await vi.waitFor(() => expect(result.current.fit).toEqual(over));
    expect(result.current.error).toBeNull();
  });

  it("treats a server failure as a failed check, not an invalid Review", async () => {
    server.use(http.post(URL, () => HttpResponse.json({ code: "INTERNAL", message: "Something went wrong." }, { status: 500 })));
    const { result, send } = setup();
    send({ type: "reject", changeId: "c2" });
    await tick(PREVIEW_DEBOUNCE_MS);
    await vi.waitFor(() => expect(result.current.error?.kind).toBe("failed"));
  });

  it("setFit replaces the fit (for a CV_TOO_LONG at submit)", () => {
    const { result } = setup();
    act(() => result.current.setFit(over));
    expect(result.current.fit).toEqual(over);
  });
});

describe("invalidReviewTarget", () => {
  const sub: ReviewSubmission = { decisions: [], drops: ["b2" as never] };
  it("finds whole IDs only", () => {
    expect(invalidReviewTarget("Decision for c1: nope.", run, sub)).toEqual({ changeId: "c1", itemId: null });
    expect(invalidReviewTarget("Decision for c10: nope.", run, sub)).toEqual({ changeId: null, itemId: null });
    expect(invalidReviewTarget("Drop b3: Change c3 already removes it.", run, sub)).toEqual({ changeId: "c3", itemId: "b3" });
    expect(invalidReviewTarget("Drop exp1: exp1 would be left with no bullet.", run, sub)).toEqual({ changeId: null, itemId: "exp1" });
    expect(invalidReviewTarget("Something else.", run, sub)).toEqual({ changeId: null, itemId: null });
  });
});
