import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import { ReviewScreen } from "@/features/review";
import { ToastProvider } from "@/ui/Toast";
import { reviewRunView } from "../../fixtures/runViews";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { server } from "../../helpers/server";

const run = reviewRunView();
const SUBMIT = `/api/runs/${run.id}/review`;
const PREVIEW = `${SUBMIT}/preview`;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  server.use(http.post(PREVIEW, () => HttpResponse.json({ fits: true, step: 0, fittable: true })));
});

function setup() {
  const user = userEvent.setup();
  const utils = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <ReviewScreen run={run} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { user, ...utils };
}

async function submit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Submit Review" }));
  const dialog = await screen.findByRole("dialog", { name: "Submit your Review?" });
  await user.click(within(dialog).getByRole("button", { name: "Submit Review" }));
}

describe("Review screen: top bar and page together", () => {
  it("opens the checklist drawer from the rail", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Open checklist" }));
    expect(await screen.findByRole("dialog", { name: /checklist/i })).toBeInTheDocument();
  });

  it("has exactly one status region while no toast is open, and no serious axe violations", async () => {
    const { container } = setup();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await expectNoSeriousViolations(container);
  });

  it("on INVALID_REVIEW at submit, focuses the named Change's card and shows the message in the alert", async () => {
    server.use(http.post(SUBMIT, () => HttpResponse.json({ code: "INVALID_REVIEW", message: "Decision for c5: it cannot be revised." }, { status: 400 })));
    const { user } = setup();
    await submit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Decision for c5: it cannot be revised.");
    const card = screen.getByRole("group", { name: /^Change 2 of 5/ });
    await waitFor(() => expect(card).toHaveFocus());
  });

  it("on CV_TOO_LONG at submit, opens the fit popover with the message and the hint card shows the new fit", async () => {
    server.use(
      http.post(SUBMIT, () => HttpResponse.json({ code: "CV_TOO_LONG", message: "Too long.", overByLines: 4 }, { status: 400 })),
      http.post(PREVIEW, () => HttpResponse.json({ fits: false, overByLines: 4, fittable: true })),
    );
    const { user } = setup();
    await submit(user);
    const popover = await screen.findByRole("dialog", { name: "Page fit" });
    expect(within(popover).getByText("Your choices run past one page. Reject an addition or drop a bullet, then submit again.")).toBeInTheDocument();
    expect(screen.getByText(/Still 4 lines over/)).toBeInTheDocument();
  });
});
