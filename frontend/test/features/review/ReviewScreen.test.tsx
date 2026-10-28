import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReviewScreen, reviewStorageKey } from "@/features/review";
import { SHORTCUTS_KEY } from "@/features/shortcuts/useShortcuts";
import { ToastProvider } from "@/ui/Toast";
import { reviewRunView } from "../../fixtures/runViews";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { server } from "../../helpers/server";

const run = reviewRunView();
const PREVIEW = `/api/runs/${run.id}/review/preview`;

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  server.use(http.post(PREVIEW, () => HttpResponse.json({ fits: true, step: 0, fittable: true })));
});
afterEach(() => window.localStorage.clear());

function setup(view = run) {
  const user = userEvent.setup();
  const utils = render(
    <ToastProvider>
      <ReviewScreen run={view} />
    </ToastProvider>,
  );
  const item = (id: string) => utils.container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
  return { user, item, ...utils };
}

const card = (n: number, total = 5) => screen.getByRole("group", { name: new RegExp(`^Change ${n} of ${total},`) });
/** The mark of an Item is the button inside its row. */
const markOf = (el: HTMLElement) => within(el).getAllByRole("button")[0]!;

describe("Review screen: the CV page", () => {
  it("draws every op from the original CV with the Changes laid over it", () => {
    const { item, container } = setup();
    expect(item("b1").querySelector("del")).toHaveTextContent("Built an internal tool.");
    expect(item("b1").querySelector("ins")).toHaveTextContent("Built an internal tool used by 40 engineers.");
    expect(item("exp1.b1").querySelector("ins")).toHaveTextContent("Cut the import time in half.");
    expect(item("b3").querySelector("del")).toHaveTextContent("Answered support emails.");
    expect(item("b4").querySelector("del, ins")).toBeNull();
    const skills = [...container.querySelectorAll('[data-item-id^="s"]')].map((el) => el.textContent);
    expect(skills).toEqual(["SQL", "Node.js"]);
    expect(screen.getByText(/Original order: Node.js, SQL/)).toBeInTheDocument();
  });

  it("gives marks text equivalents", () => {
    const { item } = setup();
    expect(item("b1")).toHaveTextContent(/Removed: Built an internal tool\.\s*Added: Built an internal tool used by 40 engineers\./);
  });

  it("shows the original again when a Change is rejected", async () => {
    const { user, item } = setup();
    await user.click(markOf(item("b1")));
    await user.click(within(card(1)).getByRole("button", { name: /^Reject/ }));
    expect(item("b1").querySelector("ins, del")).toBeNull();
    expect(item("b1")).toHaveTextContent("Built an internal tool.");
    expect(within(card(1)).getByRole("button", { name: /^Rejected/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("selects a Change by clicking its mark, without moving focus off the mark", async () => {
    const { user, item } = setup();
    await user.click(markOf(item("b2")));
    expect(within(card(2)).getByText("A reason.")).toBeInTheDocument();
    expect(item("b2")).toHaveClass("bg-accent-soft");
    expect(document.activeElement).toBe(markOf(item("b2")));
  });
});

describe("Review screen: the margin", () => {
  it("lists one collapsed card per Change in CV order, 'To review' until looked at", () => {
    setup();
    const titles = screen.getAllByRole("group", { name: /^Change \d of 5/ }).map((g) => g.getAttribute("aria-label"));
    expect(titles).toEqual([
      "Change 1 of 5, rewording, Experience",
      "Change 2 of 5, rewording, Experience",
      "Change 3 of 5, removal, Experience",
      "Change 4 of 5, addition, Experience",
      "Change 5 of 5, reordering, Skills",
    ]);
    expect(within(card(1)).getByText("Rewording · Harbor Analytics")).toBeInTheDocument();
    expect(within(card(1)).getByText("To review")).toBeInTheDocument();
    expect(within(card(1)).getByText("Built an internal tool used by 40 engineers.")).toBeInTheDocument();
  });

  it("expands the selected card with the rationale, the Evidence quotes and the Requirements", async () => {
    const { user } = setup();
    await user.click(within(card(1)).getByRole("button"));
    const open = card(1);
    expect(within(open).getByText("Rewording")).toBeInTheDocument();
    expect(within(open).getByText("Experience · 1 of 5")).toBeInTheDocument();
    expect(within(open).getByText("Based on")).toBeInTheDocument();
    expect(within(open).getByText("“Built an internal tool.”")).toBeInTheDocument();
    expect(within(open).getByText("Your CV · Harbor Analytics")).toBeInTheDocument();
    expect(within(open).getByText("Requirement r1")).toBeInTheDocument();
    expect(within(open).getByRole("button", { name: /^Accepted/ })).toBeInTheDocument();
    // the first look makes it "reviewed"; the other cards stay "To review"
    expect(within(card(2)).getByText("To review")).toBeInTheDocument();
  });

  it("quotes the Answer for an Evidence the user gave", async () => {
    const { user } = setup();
    await user.click(within(card(4)).getByRole("button"));
    expect(within(card(4)).getByText("“I cut the import time in half.”")).toBeInTheDocument();
    expect(within(card(4)).getByText("Your answer about Requirement r2")).toBeInTheDocument();
  });

  it("offers only Accept and Reject for a removal", async () => {
    const { user } = setup();
    await user.click(within(card(3)).getByRole("button"));
    expect(within(card(3)).getByRole("button", { name: /^Accepted/ })).toBeInTheDocument();
    expect(within(card(3)).queryByRole("button", { name: /^Edit/ })).toBeNull();
  });

  it("edits a rewording: prefilled, saved with Cmd+Enter, shown in the CV with the note", async () => {
    const { user, item } = setup();
    await user.click(within(card(1)).getByRole("button"));
    await user.click(within(card(1)).getByRole("button", { name: /^Edit/ }));
    const box = screen.getByLabelText("Your wording");
    expect(box).toHaveValue("Built an internal tool used by 40 engineers.");
    await user.clear(box);
    await user.type(box, "Built the tool my team uses daily.");
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(await within(card(1)).findByText("In your words: goes into the CV exactly as written.")).toBeInTheDocument();
    expect(within(card(1)).getByRole("button", { name: /^Edited/ })).toBeInTheDocument();
    expect(item("b1").querySelector("ins")).toHaveTextContent("Built the tool my team uses daily.");
  });

  it("cancels an edit with Escape, leaving the Change as it was", async () => {
    const { user, item } = setup();
    await user.click(within(card(1)).getByRole("button"));
    await user.click(within(card(1)).getByRole("button", { name: /^Edit/ }));
    await user.type(screen.getByLabelText("Your wording"), " more");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Your wording")).toBeNull();
    expect(item("b1").querySelector("ins")).toHaveTextContent("Built an internal tool used by 40 engineers.");
  });

  it("edits the order of a reorder with Move up and Move down", async () => {
    const { user, container } = setup();
    await user.click(within(card(5)).getByRole("button"));
    await user.click(within(card(5)).getByRole("button", { name: /^Edit/ }));
    await user.click(screen.getByRole("button", { name: "Move down: SQL" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    const skills = [...container.querySelectorAll('[data-item-id^="s"]')].map((el) => el.textContent);
    expect(skills).toEqual(["Node.js", "SQL"]);
    expect(within(card(5)).getByRole("button", { name: /^Edited/ })).toBeInTheDocument();
  });

  it("shows the hint card while the CV is over one page", () => {
    setup(reviewRunView({ fit: { fits: false, overByLines: 3, fittable: true } }));
    expect(screen.getByText("Still 3 lines over. Reject an addition, or select any bullet in your CV and press D to drop it.")).toBeInTheDocument();
  });

  it("has no hint card when the CV fits", () => {
    setup();
    expect(screen.queryByText(/lines over/)).toBeNull();
  });

  it("shows the server's message on the card of a Change it names", async () => {
    server.use(http.post(PREVIEW, () => HttpResponse.json({ code: "INVALID_REVIEW", message: "Decision for c1: that text is empty." }, { status: 400 })));
    const { user } = setup();
    await user.click(within(card(1)).getByRole("button"));
    await user.click(within(card(1)).getByRole("button", { name: /^Reject/ }));
    expect(await screen.findByText("Decision for c1: that text is empty.", {}, { timeout: 3000 })).toBeInTheDocument();
  });
});

describe("Review screen: dropping bullets", () => {
  it("refuses with review.md's words for each reason", async () => {
    const { user, item } = setup();
    await user.click(markOf(item("b4")));
    expect(within(item("b4")).getByText("Each job keeps at least one bullet.")).toBeInTheDocument();
    expect(within(item("b4")).getByRole("button", { name: /^Drop/ })).toBeDisabled();
    await user.click(markOf(item("b2")));
    expect(within(item("b2")).getByText("Reject its rewording to drop it.")).toBeInTheDocument();
    await user.click(markOf(item("b3")));
    expect(within(item("b3")).getByText("Already removed by an accepted Change.")).toBeInTheDocument();
    expect(within(item("b3")).queryByRole("button", { name: /^Drop/ })).toBeNull();
  });

  it("drops a bullet: struck in the CV, a card with Undo", async () => {
    const { user, item } = setup();
    await user.click(markOf(item("b3"))); // select c3
    await user.click(within(card(3)).getByRole("button", { name: /^Reject/ }));
    await user.click(within(item("b3")).getByRole("button", { name: /^Drop/ }));
    expect(item("b3").querySelector("del")).toHaveTextContent("Answered support emails.");
    const dropped = screen.getByRole("group", { name: "Dropped by you, Harbor Analytics" });
    expect(within(dropped).getByText("Dropped by you · Harbor Analytics")).toBeInTheDocument();
    await user.click(within(dropped).getByRole("button", { name: "Undo" }));
    expect(screen.queryByRole("group", { name: /Dropped by you/ })).toBeNull();
    expect(item("b3").querySelector("del")).toBeNull();
  });

  it("asks first when the bullet is Evidence for a Requirement", async () => {
    const { user, item } = setup();
    await user.click(markOf(item("b2")));
    await user.click(within(card(2)).getByRole("button", { name: /^Reject/ }));
    await user.click(within(item("b2")).getByRole("button", { name: /^Drop/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("This bullet is Evidence for 'Requirement r1'. Dropping it may lower the score.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: /Dropped by you/ })).toBeNull();
    await user.click(within(item("b2")).getByRole("button", { name: /^Drop/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Drop bullet" }));
    expect(screen.getByRole("group", { name: /Dropped by you/ })).toBeInTheDocument();
  });

  it("gives a drop back when its Change is accepted again, and says so", async () => {
    const { user, item } = setup();
    await user.click(markOf(item("b2")));
    await user.click(within(card(2)).getByRole("button", { name: /^Reject/ }));
    await user.click(within(item("b2")).getByRole("button", { name: /^Drop/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Drop bullet" }));
    expect(screen.getByRole("group", { name: /Dropped by you/ })).toBeInTheDocument();
    await user.click(within(card(2)).getByRole("button", { name: /^Accept/ }));
    expect(screen.queryByRole("group", { name: /Dropped by you/ })).toBeNull();
    expect(item("b2").querySelector("del")).toHaveTextContent("Wrote reports for the team.");
    expect(item("b2").querySelector("ins")).toHaveTextContent("Wrote weekly reports for 12 people.");
    expect(await screen.findByText("A bullet you dropped is back, because you kept its Change.")).toBeInTheDocument();
  });
});

describe("Review screen: the rail", () => {
  it("counts the filters and filters the cards, dimming the other marks", async () => {
    const { user, item } = setup();
    const rail = screen.getByRole("complementary", { name: "Filters and shortcuts" });
    const counts = Object.fromEntries(within(rail).getAllByRole("button", { pressed: false }).concat(within(rail).getAllByRole("button", { pressed: true })).map((b) => [b.textContent!.replace(/\d+$/, ""), b.textContent!.match(/\d+$/)?.[0]]));
    expect(counts).toMatchObject({ "All changes": "5", Rewordings: "2", Additions: "1", Removals: "1", Unreviewed: "5" });
    await user.click(within(rail).getByRole("button", { name: /^Additions/ }));
    expect(screen.getAllByRole("group", { name: /^Change \d of 5/ })).toHaveLength(1);
    expect(card(4)).toBeInTheDocument();
    expect(item("b1")).toHaveClass("opacity-40");
    expect(item("exp1.b1")).not.toHaveClass("opacity-40");
  });

  it("accepts or rejects everything the filter shows, with an Undo toast", async () => {
    const { user } = setup();
    const rail = screen.getByRole("complementary", { name: "Filters and shortcuts" });
    await user.click(within(rail).getByRole("button", { name: /^Rewordings/ }));
    await user.click(within(rail).getByRole("button", { name: "Bulk actions for this filter" }));
    await user.click(await screen.findByRole("menuitem", { name: "Reject all (2)" }));
    await user.click(within(rail).getByRole("button", { name: /^All changes/ }));
    expect(within(card(1)).getByText("Rejected")).toBeInTheDocument();
    expect(within(card(2)).getByText("Rejected")).toBeInTheDocument();
    expect(within(card(3)).getByText("To review")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(within(card(1)).getByText("Accepted")).toBeInTheDocument();
  });

  it("summarises the must-haves and keeps the keyboard legend and the shortcuts switch", () => {
    setup();
    expect(screen.getByText("3 of 3 must-haves met")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open checklist" })).toBeInTheDocument();
    expect(screen.getByText("drops the selected bullet")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Keyboard shortcuts" })).toBeChecked();
  });
});

describe("Review screen: shortcuts and undo", () => {
  it("J and K move through the cards and A, R, E act on the selected one", async () => {
    const { user } = setup();
    await user.keyboard("j");
    expect(within(card(1)).getByRole("button", { name: /^Accepted/ })).toBeInTheDocument();
    expect(card(1)).toHaveFocus();
    await user.keyboard("j");
    expect(within(card(2)).getByRole("button", { name: /^Accepted/ })).toBeInTheDocument();
    await user.keyboard("k");
    expect(within(card(1)).getByRole("button", { name: /^Accepted/ })).toBeInTheDocument();
    await user.keyboard("r");
    expect(within(card(1)).getByRole("button", { name: /^Rejected/ })).toBeInTheDocument();
    await user.keyboard("a");
    expect(within(card(1)).getByRole("button", { name: /^Accepted/ })).toBeInTheDocument();
    await user.keyboard("e");
    expect(screen.getByLabelText("Your wording")).toBeInTheDocument();
  });

  it("does not act while typing in a text field", async () => {
    const { user } = setup();
    await user.keyboard("j");
    await user.keyboard("e");
    await user.type(screen.getByLabelText("Your wording"), "jrad");
    expect(screen.getByLabelText("Your wording")).toHaveValue("Built an internal tool used by 40 engineers.jrad");
    expect(within(card(1)).queryByRole("button", { name: /^Rejected/ })).toBeNull();
  });

  it("D drops the selected bullet", async () => {
    const { user, item } = setup();
    await user.click(markOf(item("b3")));
    await user.click(within(card(3)).getByRole("button", { name: /^Reject/ }));
    await user.keyboard("d");
    expect(screen.getByRole("group", { name: "Dropped by you, Harbor Analytics" })).toBeInTheDocument();
  });

  it("Cmd+Z undoes the last decision", async () => {
    const { user } = setup();
    await user.keyboard("j");
    await user.keyboard("r");
    expect(within(card(1)).getByRole("button", { name: /^Rejected/ })).toBeInTheDocument();
    await user.keyboard("{Meta>}z{/Meta}");
    expect(within(card(1)).getByRole("button", { name: /^Accepted/ })).toBeInTheDocument();
  });

  it("does nothing when the shortcuts switch is off", async () => {
    window.localStorage.setItem(SHORTCUTS_KEY, "off");
    const { user } = setup();
    await user.keyboard("j");
    expect(within(card(1)).queryByRole("button", { name: /^Accepted/ })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Keyboard shortcuts" }));
    await user.keyboard("j");
    expect(within(card(1)).getByRole("button", { name: /^Accepted/ })).toBeInTheDocument();
  });

  it("every decision has an Undo toast", async () => {
    const { user } = setup();
    await user.keyboard("j");
    await user.keyboard("r");
    expect(await screen.findByText("Change rejected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(within(card(1)).getByRole("button", { name: /^Accepted/ })).toBeInTheDocument();
  });
});

describe("Review screen: a saved selection", () => {
  it("scrolls to and focuses the selected card when the selection did not come from a click", async () => {
    window.sessionStorage.setItem(
      reviewStorageKey(run.id),
      JSON.stringify({ v: 1, changeIds: run.changes.map((c) => c.id), decisions: {}, drops: [], reviewed: ["c3"], selectedId: "c3" }),
    );
    setup();
    await waitFor(() => expect(card(3)).toHaveFocus());
  });
});

describe("Review screen: page", () => {
  it("has one status region, a title and no serious axe violations", async () => {
    const { container, user } = setup();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Review" })).toBeInTheDocument();
    await expectNoSeriousViolations(container);
    await act(async () => void (await user.click(within(card(1)).getByRole("button"))));
    await expectNoSeriousViolations(container);
  });
});
