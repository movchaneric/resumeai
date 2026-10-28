import { act, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewTopBarProps } from "@/features/review/topbar/ReviewTopBar";
import { ReviewScreen } from "@/features/review";
import { ToastProvider } from "@/ui/Toast";
import { reviewRunView } from "../../fixtures/runViews";
import { server } from "../../helpers/server";

// The real top bar is ticket #76; this stands in for it to prove the seam: what the page hands it and what it does back.
let bar: ReviewTopBarProps | null = null;
vi.mock("@/features/review/topbar/ReviewTopBar", () => ({
  ReviewTopBar: (props: ReviewTopBarProps) => {
    bar = props;
    return <h1>Review</h1>;
  },
}));

const run = reviewRunView();
beforeEach(() => {
  bar = null;
  window.sessionStorage.clear();
  server.use(http.post(`/api/runs/${run.id}/review/preview`, () => HttpResponse.json({ fits: true, step: 0, fittable: true })));
});

function setup() {
  return render(
    <ToastProvider>
      <ReviewScreen run={run} />
    </ToastProvider>,
  );
}

describe("Review screen seams with the top bar", () => {
  it("gives the top bar the run, the single useReview result and a highlight setter", () => {
    setup();
    expect(bar!.run).toBe(run);
    expect(bar!.review.state.changeIds).toEqual(["c1", "c2", "c3", "c4", "c5"]);
    expect(typeof bar!.onHighlightChanges).toBe("function");
  });

  it("outlines the Items and cards of the Changes the top bar highlights, and clears them", () => {
    const { container } = setup();
    act(() => bar!.onHighlightChanges(["c1", "c5"]));
    expect(container.querySelector('[data-item-id="b1"]')).toHaveClass("ring-2");
    expect(container.querySelector('[data-item-id="b2"]')).toHaveClass("ring-2");
    expect(container.querySelector('[data-item-id="b3"]')).not.toHaveClass("ring-2");
    expect(screen.getByRole("group", { name: /^Change 1 of 5/ })).toHaveClass("ring-2");
    act(() => bar!.onHighlightChanges([]));
    expect(container.querySelector('[data-item-id="b1"]')).not.toHaveClass("ring-2");
  });

  it("scrolls to and focuses the card when the top bar selects a Change", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    setup();
    act(() => bar!.review.dispatch({ type: "select", changeId: "c4" }));
    const card = await screen.findByRole("group", { name: /^Change 5 of 5/ });
    await waitFor(() => expect(card).toHaveFocus());
    expect(within(card).getByRole("button", { name: /^Accepted/ })).toBeInTheDocument();
    expect(scroll).toHaveBeenCalled();
    scroll.mockRestore();
  });

  it("shows the Review in the same screen: the hint card reads the shared fit", () => {
    setup();
    act(() => bar!.review.fit.setFit({ fits: false, overByLines: 2, fittable: true }));
    expect(screen.getByText(/^Still 2 lines over\./)).toBeInTheDocument();
  });
});
