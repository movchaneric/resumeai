import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewStorageKey, useReview } from "@/features/review";
import type { ReviewRun } from "@/features/review";
import { ReviewTopBar } from "@/features/review/topbar/ReviewTopBar";
import { runKey } from "@/features/run/useRun";
import { ToastProvider } from "@/ui/Toast";
import { reviewRunView } from "../../../fixtures/runViews";
import { expectNoSeriousViolations } from "../../../helpers/axe";
import { server } from "../../../helpers/server";

const baseRun = reviewRunView();
const PREVIEW = (run: ReviewRun) => `/api/runs/${run.id}/review/preview`;
const SUBMIT = (run: ReviewRun) => `/api/runs/${run.id}/review`;

/** Stands in for ReviewScreen: calls useReview itself and hands the result to the top bar. */
function Harness({ run, onHighlight }: { run: ReviewRun; onHighlight: (ids: string[]) => void }) {
  const review = useReview(run);
  return (
    <>
      <ReviewTopBar run={run} review={review} onHighlightChanges={onHighlight} />
      <button onClick={() => review.dispatch({ type: "reject", changeId: "c4" })}>test: reject c4</button>
      <button
        onClick={() => {
          review.dispatch({ type: "reject", changeId: "c5" });
          review.dispatch({ type: "drop", itemId: "b2" as never });
        }}
      >
        test: drop b2
      </button>
      <p data-testid="selected">{review.state.selectedId ?? "none"}</p>
    </>
  );
}

function setup(run: ReviewRun = baseRun) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onHighlight = vi.fn();
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <Harness run={run} onHighlight={onHighlight} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, client, invalidate, onHighlight };
}

beforeEach(() => window.sessionStorage.clear());

describe("ReviewTopBar", () => {
  it("shows the title, the job line, progress and the score chip", async () => {
    const { container } = setup();
    expect(screen.getByRole("heading", { name: "Review" })).toBeInTheDocument();
    expect(screen.getByText("Senior Backend Engineer at Northwind Labs")).toBeInTheDocument();
    expect(screen.getByText("0 of 5 reviewed")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Review progress" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("button", { name: /Match Score \d+ → \d+/ })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await expectNoSeriousViolations(container);
  });

  it("Next unreviewed selects the next unreviewed Change and counts it as reviewed", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Next unreviewed/ }));
    expect(screen.getByTestId("selected")).toHaveTextContent("c1");
    expect(screen.getByText("1 of 5 reviewed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Next unreviewed/ }));
    expect(screen.getByTestId("selected")).toHaveTextContent("c2");
  });

  describe("fit chip", () => {
    it("says Fits one page and explains the step", async () => {
      setup();
      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("Fits one page");
      await userEvent.click(within(status).getByRole("button"));
      const popover = screen.getByRole("dialog", { name: "Page fit" });
      expect(within(popover).getByText("Fits one page at size step 1 of 7")).toBeInTheDocument();
      expect(within(popover).getByRole("img", { name: "Size step 1 of 7" })).toBeInTheDocument();
      expect(within(popover).queryByText("Reject an addition, or drop a bullet.")).toBeNull();
      await expectNoSeriousViolations(popover);
    });

    it("says how many lines over, with the tip and an overflow bar", async () => {
      setup(reviewRunView({ fit: { fits: false, overByLines: 3, fittable: true } }));
      expect(screen.getByRole("status")).toHaveTextContent("3 lines over one page");
      await userEvent.click(within(screen.getByRole("status")).getByRole("button"));
      const popover = screen.getByRole("dialog", { name: "Page fit" });
      expect(within(popover).getByText("3 lines over one page, even at the smallest size")).toBeInTheDocument();
      expect(within(popover).getByText("Reject an addition, or drop a bullet.")).toBeInTheDocument();
      expect(within(popover).getByRole("img")).toHaveAccessibleName("All 7 size steps used, 3 lines over");
    });

    it("says 1 line, not 1 lines", () => {
      setup(reviewRunView({ fit: { fits: false, overByLines: 1, fittable: true } }));
      expect(screen.getByRole("status")).toHaveTextContent("1 line over one page");
    });

    it("shows the not-fittable note and never blocks Submit", async () => {
      setup(reviewRunView({ fit: { fits: false, overByLines: 2, fittable: false } }));
      await userEvent.click(within(screen.getByRole("status")).getByRole("button"));
      expect(screen.getByText("This CV can't fit one page even with every removal, so you can submit it as it is.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Submit Review" })).toBeEnabled();
    });

    it("says Checking fit… while a preview runs, then shows the answer", async () => {
      let answer!: () => void;
      const gate = new Promise<void>((resolve) => (answer = resolve));
      server.use(
        http.post(PREVIEW(baseRun), async () => {
          await gate;
          return HttpResponse.json({ fits: false, overByLines: 2, fittable: true });
        }),
      );
      setup();
      await userEvent.click(screen.getByRole("button", { name: "test: reject c4" }));
      expect(await screen.findByText("Checking fit…", {}, { timeout: 2000 })).toBeInTheDocument();
      answer();
      expect(await screen.findByText("2 lines over one page")).toBeInTheDocument();
      expect(screen.getAllByRole("status")).toHaveLength(1);
    });

    it("shows Couldn't check the fit with Retry when the preview fails, and Retry asks again", async () => {
      let calls = 0;
      server.use(
        http.post(PREVIEW(baseRun), () => {
          calls++;
          return calls === 1 ? HttpResponse.json({ code: "INTERNAL", message: "Something went wrong." }, { status: 500 }) : HttpResponse.json({ fits: true, step: 2, fittable: true });
        }),
      );
      setup();
      await userEvent.click(screen.getByRole("button", { name: "test: reject c4" }));
      await waitFor(() => expect(calls).toBe(1), { timeout: 2000 });
      await userEvent.click(within(screen.getByRole("status")).getByRole("button"));
      const popover = await screen.findByRole("dialog", { name: "Page fit" });
      expect(await within(popover).findByText("Couldn't check the fit")).toBeInTheDocument();
      await userEvent.click(within(popover).getByRole("button", { name: "Retry" }));
      expect(await within(popover).findByText("Fits one page at size step 3 of 7")).toBeInTheDocument();
      expect(within(popover).queryByText("Couldn't check the fit")).toBeNull();
    });
  });

  describe("checklist drawer", () => {
    async function open() {
      const utils = setup();
      await userEvent.click(screen.getByRole("button", { name: /Match Score/ }));
      return { ...utils, drawer: await screen.findByRole("dialog", { name: "Requirement checklist" }) };
    }

    it("groups must-have before nice-to-have, with verdict words and the As proposed note", async () => {
      const { drawer } = await open();
      expect(within(drawer).getByText(/As proposed\. The final score is recalculated from your decisions when you submit\./)).toBeInTheDocument();
      const musts = within(drawer).getByRole("region", { name: "Must-have" });
      expect(within(musts).getAllByRole("listitem").filter((li) => li.textContent?.startsWith("Requirement"))).toHaveLength(3);
      const nice = within(drawer).getByRole("region", { name: "Nice-to-have" });
      expect(within(nice).getByText("Requirement r3")).toBeInTheDocument();
      expect(within(nice).getByText("partially met")).toBeInTheDocument();
      expect(within(nice).getByText("met")).toBeInTheDocument();
      await expectNoSeriousViolations(drawer);
    });

    it("expands a reason with its Evidence text", async () => {
      const { drawer } = await open();
      const row = within(drawer).getByText("Requirement r2").closest("li")!;
      expect(within(row).queryByText("Why r2 is met.")).toBeNull();
      await userEvent.click(within(row).getByRole("button", { name: /Why this verdict/ }));
      expect(within(row).getByText("Why r2 is met.")).toBeInTheDocument();
      expect(within(row).getByText("“I cut the import time in half.”")).toBeInTheDocument();
    });

    it("shows the Confirmed Gap chip", async () => {
      const gap = reviewRunView();
      gap.requirements[3]!.confirmedGap = true;
      setup(gap);
      await userEvent.click(screen.getByRole("button", { name: /Match Score/ }));
      const row = (await screen.findByText("Requirement r4")).closest("li")!;
      expect(within(row).getByText("Confirmed Gap")).toBeInTheDocument();
    });

    it("marks Requirements that may change under the current decisions", async () => {
      setup();
      await userEvent.click(screen.getByRole("button", { name: "test: reject c4" }));
      await userEvent.click(screen.getByRole("button", { name: /Match Score/ }));
      const drawer = await screen.findByRole("dialog", { name: "Requirement checklist" });
      expect(within(within(drawer).getByText("Requirement r3").closest("li")!).getByText("May change")).toBeInTheDocument();
      expect(within(drawer).getAllByText("May change")).toHaveLength(1);
    });

    it("highlights the citing Changes on hover and focus, and clears on leave and blur", async () => {
      const { drawer, onHighlight } = await open();
      const row = within(drawer).getByText("Requirement r1").closest("li")!;
      await userEvent.hover(row);
      expect(onHighlight).toHaveBeenLastCalledWith(["c1", "c5"]);
      await userEvent.unhover(row);
      expect(onHighlight).toHaveBeenLastCalledWith([]);
      await userEvent.tab();
      const toggle = within(row).getByRole("button", { name: /Why this verdict/ });
      toggle.focus();
      expect(onHighlight).toHaveBeenLastCalledWith(["c1", "c5"]);
      toggle.blur();
      expect(onHighlight).toHaveBeenLastCalledWith([]);
    });
  });

  describe("submit", () => {
    async function openDialog() {
      const utils = setup();
      await userEvent.click(screen.getByRole("button", { name: "test: reject c4" }));
      await userEvent.click(screen.getByRole("button", { name: "test: drop b2" }));
      await userEvent.click(screen.getByRole("button", { name: "Submit Review" }));
      return { ...utils, dialog: await screen.findByRole("dialog", { name: "Submit your Review?" }) };
    }

    it("sums up the decisions, and Keep reviewing closes it", async () => {
      const { dialog } = await openDialog();
      expect(dialog).toHaveAccessibleDescription("Accept 3, edit 0, reject 2, drop 1. The Review is final.");
      await expectNoSeriousViolations(dialog);
      await userEvent.click(within(dialog).getByRole("button", { name: "Keep reviewing" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("on 202 sends the submission, clears the saved review and refreshes the Run", async () => {
      const body = vi.fn();
      server.use(http.post(SUBMIT(baseRun), async ({ request }) => (body(await request.json()), HttpResponse.json({ id: baseRun.id }, { status: 202 }))));
      const { dialog, invalidate } = await openDialog();
      expect(window.sessionStorage.getItem(reviewStorageKey(baseRun.id))).not.toBeNull();
      await userEvent.click(within(dialog).getByRole("button", { name: "Submit Review" }));
      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: runKey(baseRun.id) }));
      expect(body).toHaveBeenCalledOnce();
      expect(body.mock.calls[0]![0]).toMatchObject({ drops: ["b2"] });
      expect(body.mock.calls[0]![0].decisions[3]).toEqual({ changeId: "c4", decision: "reject" });
      expect(window.sessionStorage.getItem(reviewStorageKey(baseRun.id))).toBeNull();
    });

    it("on 400 CV_TOO_LONG sets the fit, closes the dialog and opens the popover with the message and focus", async () => {
      server.use(
        http.post(SUBMIT(baseRun), () => HttpResponse.json({ code: "CV_TOO_LONG", message: "Too long.", overByLines: 4 }, { status: 400 })),
        http.post(PREVIEW(baseRun), () => HttpResponse.json({ fits: false, overByLines: 4, fittable: true })),
      );
      const { dialog } = await openDialog();
      await userEvent.click(within(dialog).getByRole("button", { name: "Submit Review" }));
      const popover = await screen.findByRole("dialog", { name: "Page fit" });
      expect(screen.queryByRole("dialog", { name: "Submit your Review?" })).toBeNull();
      expect(within(popover).getByText("Your choices run past one page. Reject an addition or drop a bullet, then submit again.")).toBeInTheDocument();
      await waitFor(() => expect(popover).toHaveFocus());
      expect(within(popover).getByText("4 lines over one page, even at the smallest size")).toBeInTheDocument();
    });

    it("on 400 INVALID_REVIEW selects the named Change and shows the message", async () => {
      server.use(http.post(SUBMIT(baseRun), () => HttpResponse.json({ code: "INVALID_REVIEW", message: "Decision for c5: it cannot be revised." }, { status: 400 })));
      const { dialog } = await openDialog();
      await userEvent.click(within(dialog).getByRole("button", { name: "Submit Review" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Decision for c5: it cannot be revised.");
      expect(screen.getByTestId("selected")).toHaveTextContent("c5");
      expect(screen.queryByRole("dialog", { name: "Submit your Review?" })).toBeNull();
    });

    it("on another failure keeps the dialog open with a message", async () => {
      server.use(http.post(SUBMIT(baseRun), () => HttpResponse.json({ code: "INTERNAL", message: "Boom." }, { status: 500 })));
      const { dialog } = await openDialog();
      await userEvent.click(within(dialog).getByRole("button", { name: "Submit Review" }));
      expect(await within(dialog).findByText("Couldn't submit your Review. Try again.")).toBeInTheDocument();
    });
  });

  it("has a ⋯ menu with Copy link and Delete Run", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Run options" }));
    expect(await screen.findByRole("menuitem", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete Run" })).toBeInTheDocument();
  });
});
