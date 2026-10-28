import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RUN_ID, STATUSES, runView } from "../fixtures/runViews";
import { expectNoSeriousViolations } from "../helpers/axe";
import { renderApp, serveIdleStream, serveRun } from "../helpers/render";

const PATH = `/runs/${RUN_ID}`;

describe("/runs/:id status switch", () => {
  it("covers every RunView status", () => {
    expect(STATUSES).toHaveLength(8);
  });

  it.each([
    ["parsing", "Reading your CV…"],
    ["extracting", "Tailoring your CV"],
    ["awaiting_answers", "Have you used Node.js?"],
    ["tailoring", "Tailoring your CV"],
    ["awaiting_review", "Review your Changes"],
    ["completed", "Your tailored CV is ready"],
    ["failed", "This Run didn't finish"],
    ["interrupted", "This Run was cut off"],
  ] as const)("renders the %s screen with one status region and no serious axe violations", async (status, title) => {
    serveRun(RUN_ID, runView(status));
    serveIdleStream(RUN_ID);
    const { container } = renderApp(PATH);

    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await expectNoSeriousViolations(container);
  });

  it("shows the job in the header once the Run is known", async () => {
    serveRun(RUN_ID, runView("awaiting_review"));
    renderApp(PATH);
    expect(await screen.findByText("Senior Backend Engineer · Northwind Labs")).toBeInTheDocument();
  });

  it("leaves the job out of the header when the Run has none", async () => {
    serveRun(RUN_ID, runView("awaiting_review", { job: null }));
    renderApp(PATH);
    await screen.findByRole("heading", { level: 1, name: "Review your Changes" });
    expect(screen.queryByText(/Northwind/)).toBeNull();
  });

  it("tailoring shows the Match Score so far and the round", async () => {
    serveRun(RUN_ID, runView("tailoring"));
    serveIdleStream(RUN_ID);
    renderApp(PATH);
    await screen.findByRole("heading", { name: "Tailoring your CV" });
    expect(screen.getByText("Round 2 of 3")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Tailoring, round 2 of 3.");
  });

  it("the Review placeholder shows the score and the number of Changes", async () => {
    serveRun(RUN_ID, runView("awaiting_review"));
    renderApp(PATH);
    await screen.findByRole("heading", { name: "Review your Changes" });
    const changes = screen.getByText("Changes", { selector: "dt" }).parentElement!;
    expect(within(changes).getByText("3")).toBeInTheDocument();
    expect(screen.getByText("54 → 72")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Ready for your Review: 3 Changes.");
  });

  it("a failed Run shows the message for its error code and a way to start a new Run", async () => {
    serveRun(RUN_ID, runView("failed"));
    renderApp(PATH);
    expect(await screen.findByText("We found no Requirements in this Job Description.")).toBeInTheDocument();
    expect(screen.getByText("Paste the full posting, including its requirements.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new Run" })).toHaveAttribute("href", "/");
  });
});
