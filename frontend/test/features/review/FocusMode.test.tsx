import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReviewScreen } from "@/features/review";
import { ToastProvider } from "@/ui/Toast";
import { reviewRunView } from "../../fixtures/runViews";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { server } from "../../helpers/server";

const run = reviewRunView();
const PREVIEW = `/api/runs/${run.id}/review/preview`;

/** A controllable `matchMedia`: `(min-width: 1024px)` follows `viewport.width`; other queries do not match. */
const viewport = { width: 390, listeners: new Set<() => void>() };
function installMatchMedia() {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("min-width: 1024px") ? viewport.width >= 1024 : false;
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => viewport.listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => viewport.listeners.delete(fn),
  })) as unknown as typeof window.matchMedia;
}
function resize(width: number) {
  viewport.width = width;
  act(() => viewport.listeners.forEach((fn) => fn()));
}

const original = window.matchMedia;
beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  viewport.width = 390;
  viewport.listeners.clear();
  installMatchMedia();
  server.use(http.post(PREVIEW, () => HttpResponse.json({ fits: true, step: 0, fittable: true })));
});
afterEach(() => {
  window.matchMedia = original;
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

const current = () => screen.getByRole("group", { name: /^Change \d+ of 5,/ });
const label = () => current().getAttribute("aria-label")!;
const bar = () => within(screen.getByRole("navigation", { name: "Review actions" }));

describe("Review focus mode at 390px", () => {
  it("shows one card at a time with the top, the 48px decision buttons and the navigation", () => {
    setup();
    expect(screen.getAllByRole("group", { name: /^Change \d+ of 5,/ })).toHaveLength(1);
    expect(label()).toMatch(/^Change 1 of 5,/);
    expect(screen.getByRole("heading", { level: 1, name: "Review" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Match Score/ })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Review progress" })).toBeInTheDocument();
    expect(bar().getByRole("button", { name: "Reject" })).toHaveClass("min-h-12");
    expect(bar().getByRole("button", { name: "Accept" })).toHaveClass("min-h-12");
    expect(bar().getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(bar().getByRole("button", { name: "See the whole CV" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Next unreviewed" })).toBeNull();
  });

  it("walks through the cards with Skip and Previous, each with its question", async () => {
    const { user } = setup();
    const titles: string[] = [];
    for (let n = 1; n <= 5; n++) {
      expect(label()).toMatch(new RegExp(`^Change ${n} of 5,`));
      titles.push(within(current()).getByRole("heading", { level: 2 }).textContent!);
      if (n < 5) await user.click(bar().getByRole("button", { name: "Skip" }));
    }
    expect(bar().getByRole("button", { name: "Skip" })).toBeDisabled();
    expect(titles).toEqual(expect.arrayContaining(["Use this rewording?", "Add this bullet?", "Remove this bullet to fit one page?", "Use this new order?"]));
    await user.click(bar().getByRole("button", { name: "Previous" }));
    expect(label()).toMatch(/^Change 4 of 5,/);
    expect(screen.getByText("5 of 5")).toBeInTheDocument();
  });

  it("labels the decision buttons Keep it / Remove on a removal", async () => {
    const { user } = setup();
    while (!/removal/.test(label())) await user.click(bar().getByRole("button", { name: "Skip" }));
    expect(bar().getByRole("button", { name: "Keep it" })).toBeInTheDocument();
    expect(bar().getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(within(current()).queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("moves with a swipe, and ignores one that starts in a text field", async () => {
    const { user } = setup();
    const swipe = (target: Element, from: number, to: number) => {
      fireEvent.pointerDown(target, { clientX: from, clientY: 100, pointerId: 1 });
      fireEvent.pointerUp(target, { clientX: to, clientY: 105, pointerId: 1 });
    };
    swipe(current(), 300, 100);
    expect(label()).toMatch(/^Change 2 of 5,/);
    swipe(current(), 100, 300);
    expect(label()).toMatch(/^Change 1 of 5,/);
    swipe(current(), 150, 140); // too short
    expect(label()).toMatch(/^Change 1 of 5,/);
    await user.click(within(current()).getByRole("button", { name: "Edit" }));
    const field = within(current()).getByRole("textbox", { name: "Your wording" });
    swipe(field, 300, 100);
    expect(label()).toMatch(/^Change 1 of 5,/);
    expect(field).toBeInTheDocument();
  });

  it("does not attach the desktop shortcuts", () => {
    setup();
    fireEvent.keyDown(document.body, { key: "j" });
    fireEvent.keyDown(document.body, { key: "r" });
    expect(label()).toMatch(/^Change 1 of 5,/);
    expect(bar().getByRole("button", { name: "Reject" })).toHaveAttribute("aria-pressed", "false");
  });

  it("edits a Change in the card", async () => {
    const { user } = setup();
    await user.click(within(current()).getByRole("button", { name: "Edit" }));
    const field = within(current()).getByRole("textbox", { name: "Your wording" });
    await user.clear(field);
    await user.type(field, "My own words.");
    await user.click(within(current()).getByRole("button", { name: /^Save/ }));
    expect(within(current()).getByText("In your words: goes into the CV exactly as written.")).toBeInTheDocument();
    expect(within(current()).getByText("My own words.")).toBeInTheDocument();
  });

  it("shares decisions with the desktop layout when the media query changes", async () => {
    const { user } = setup();
    await user.click(bar().getByRole("button", { name: "Reject" }));
    await user.click(bar().getByRole("button", { name: "Skip" }));
    await user.click(bar().getByRole("button", { name: "Accept" }));
    resize(1280);
    expect(screen.queryByRole("navigation", { name: "Review actions" })).toBeNull();
    expect(screen.getAllByRole("group", { name: /^Change \d+ of 5,/ })).toHaveLength(5);
    const first = screen.getByRole("group", { name: /^Change 1 of 5,/ });
    const second = screen.getByRole("group", { name: /^Change 2 of 5,/ });
    expect(within(first).getByText("Rejected")).toBeInTheDocument();
    expect(second).toHaveAttribute("data-card-id");
    expect(screen.getByText("2 of 5 reviewed")).toBeInTheDocument();
    // and back again: a desktop decision shows in focus mode.
    await user.click(within(second).getByRole("button", { name: /^Reject/ }));
    resize(390);
    expect(label()).toMatch(/^Change 2 of 5,/);
    expect(bar().getByRole("button", { name: "Reject" })).toHaveAttribute("aria-pressed", "true");
  });

  it("has exactly one status region", () => {
    setup();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("opens the fit and the checklist as sheets", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /Show details/ }));
    const fit = await screen.findByRole("dialog", { name: "Page fit" });
    expect(within(fit).getByText("Fits one page at size step 1 of 7")).toBeInTheDocument();
    await user.click(within(fit).getByRole("button", { name: "Close page fit" }));
    await user.click(screen.getByRole("button", { name: /Match Score/ }));
    expect(await screen.findByRole("dialog", { name: /Requirement checklist/ })).toBeInTheDocument();
  });

  it("drops a bullet from the whole-CV view: tap it, then Drop", async () => {
    const { user } = setup();
    while (!/removal/.test(label())) await user.click(bar().getByRole("button", { name: "Skip" }));
    await user.click(bar().getByRole("button", { name: "Keep it" })); // reject c3, so b3 is droppable
    await user.click(bar().getByRole("button", { name: "See the whole CV" }));
    const cv = await screen.findByRole("dialog", { name: "Your CV" });
    const b3 = cv.querySelector<HTMLElement>('[data-item-id="b3"]')!;
    await user.click(within(b3).getAllByRole("button")[0]!);
    await user.click(within(b3).getByRole("button", { name: "Drop" }));
    expect(b3.querySelector("del")).toHaveTextContent("Answered support emails.");
    await user.click(within(cv).getByRole("button", { name: /Back to the Change/ }));
    expect(screen.getByText("1 bullet dropped by you.")).toBeInTheDocument();
    // the shared state knows: the desktop layout lists the drop
    resize(1280);
    expect(screen.getByRole("group", { name: "Dropped by you, Harbor Analytics" })).toBeInTheDocument();
  });

  it("explains a refused drop in the whole-CV view", async () => {
    const { user } = setup();
    await user.click(bar().getByRole("button", { name: "See the whole CV" }));
    const cv = await screen.findByRole("dialog", { name: "Your CV" });
    const b4 = cv.querySelector<HTMLElement>('[data-item-id="b4"]')!;
    await user.click(within(b4).getAllByRole("button")[0]!);
    expect(within(b4).getByText("Each job keeps at least one bullet.")).toBeInTheDocument();
    expect(within(b4).getByRole("button", { name: "Drop" })).toBeDisabled();
  });

  it('opens "Show it in the CV" on the Change', async () => {
    const { user } = setup();
    await user.click(within(current()).getByRole("button", { name: "Show it in the CV" }));
    const cv = await screen.findByRole("dialog", { name: "Your CV" });
    expect(cv.querySelector("[data-change-id] [aria-current], [data-change-id][aria-current], [aria-current='true']")).not.toBeNull();
  });

  it("offers Submit in the bar only once every Change has been seen, and always in the menu", async () => {
    const { user } = setup();
    expect(bar().queryByRole("button", { name: "Submit Review" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Run options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Submit Review" }));
    const dialog = await screen.findByRole("dialog", { name: "Submit your Review?" });
    await user.click(within(dialog).getByRole("button", { name: "Keep reviewing" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Submit your Review?" })).toBeNull());
    for (let n = 1; n < 5; n++) {
      expect(bar().queryByRole("button", { name: "Submit Review" })).toBeNull();
      await user.click(bar().getByRole("button", { name: "Skip" }));
    }
    await user.click(bar().getByRole("button", { name: "Submit Review" }));
    expect(await screen.findByRole("dialog", { name: "Submit your Review?" })).toBeInTheDocument();
  });

  it("has no serious axe violations, on the card and in the whole-CV view", async () => {
    const { user, container } = setup();
    await expectNoSeriousViolations(container);
    await user.click(bar().getByRole("button", { name: "See the whole CV" }));
    const cv = await screen.findByRole("dialog", { name: "Your CV" });
    await expectNoSeriousViolations(cv);
  });
});
