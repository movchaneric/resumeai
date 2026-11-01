import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { RunIdSchema, RunStatusSchema, type RunSummary } from "@resume-ai/shared";
import { STAGE_LABEL, STAGE_OF } from "@/features/myRuns/status";
import { ADA, serveAccount, serveMyRuns } from "../../helpers/account";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { renderApp } from "../../helpers/render";
import { server } from "../../helpers/server";

const ID1 = RunIdSchema.parse("0b7e6f8e-1c2d-4e5f-8a9b-0c1d2e3f4a01");
const ID2 = RunIdSchema.parse("0b7e6f8e-1c2d-4e5f-8a9b-0c1d2e3f4a02");

const summary = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  id: ID1,
  status: "completed",
  createdAt: "2026-11-01T12:00:00.000Z",
  jobTitle: "Backend Engineer",
  company: "Acme",
  matchScore: 72,
  ...overrides,
});

describe("My Runs route", () => {
  it("sends a guest to sign in with next=/runs", async () => {
    const { router } = renderApp("/runs");
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(router.state.location.search).toBe("?next=/runs");
  });

  it("shows a loading state while the Account is pending", async () => {
    server.use(http.get("/api/account", () => new Promise<Response>(() => {})));
    const { container } = renderApp("/runs");
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });

  it("shows a loading state while the Runs load", async () => {
    serveAccount(ADA);
    server.use(http.get("/api/runs", () => new Promise<Response>(() => {})));
    const { container } = renderApp("/runs");
    expect(await screen.findByText("Loading your Runs…")).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });

  it("shows the empty state with a link to tailor a CV", async () => {
    serveAccount(ADA);
    serveMyRuns([]);
    const { container } = renderApp("/runs");
    expect(await screen.findByText("No Runs yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Tailor a CV" })).toHaveAttribute("href", "/");
    await expectNoSeriousViolations(container);
  });

  it("shows an error with a retry button that loads the Runs", async () => {
    const user = userEvent.setup();
    serveAccount(ADA);
    let fail = true;
    server.use(
      http.get("/api/runs", () => (fail ? HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 }) : HttpResponse.json({ runs: [summary()] }))),
    );
    const { container } = renderApp("/runs");
    expect(await screen.findByText("Couldn't load your Runs.")).toBeInTheDocument();
    await expectNoSeriousViolations(container);
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Backend Engineer")).toBeInTheDocument();
  });

  it("lists rows newest first with job, company, date, status, score and actions", async () => {
    serveAccount(ADA);
    serveMyRuns([summary(), summary({ id: ID2, jobTitle: null, company: null, matchScore: null, status: "parsing", createdAt: "2026-10-30T12:00:00.000Z" })]);
    const { container } = renderApp("/runs");
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText("Backend Engineer")).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/Acme/)).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Done")).toBeInTheDocument();
    expect(within(rows[0]!).getByText("Match 72")).toBeInTheDocument();
    expect(within(rows[0]!).getByRole("link", { name: "Open Backend Engineer" })).toHaveAttribute("href", `/runs/${ID1}`);
    expect(within(rows[0]!).getByText(/Nov.*2026/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Untitled job")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("In progress")).toBeInTheDocument();
    expect(within(rows[1]!).queryByText(/Match/)).toBeNull();
    expect(within(rows[1]!).queryByText(/Acme/)).toBeNull();
    await expectNoSeriousViolations(container);
  });

  it("maps every status to a stage chip", async () => {
    const statuses = RunStatusSchema.options;
    serveAccount(ADA);
    serveMyRuns(statuses.map((status, i) => summary({ id: RunIdSchema.parse(`0b7e6f8e-1c2d-4e5f-8a9b-0c1d2e3f4a${String(i).padStart(2, "0")}`), status, jobTitle: `Job ${status}` })));
    renderApp("/runs");
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(statuses.length);
    statuses.forEach((status, i) => {
      expect(within(rows[i]!).getByText(STAGE_LABEL[STAGE_OF[status]])).toBeInTheDocument();
    });
    expect(STAGE_OF).toEqual({
      parsing: "in_progress",
      extracting: "in_progress",
      tailoring: "in_progress",
      awaiting_answers: "answering",
      awaiting_review: "in_review",
      completed: "done",
      failed: "failed",
      interrupted: "failed",
    });
  });

  it("offers downloads only for a done Run", async () => {
    serveAccount(ADA);
    serveMyRuns([summary(), summary({ id: ID2, status: "awaiting_review", jobTitle: "Other" })]);
    renderApp("/runs");
    const rows = await screen.findAllByRole("listitem");
    expect(within(rows[0]!).getByRole("link", { name: "Download PDF" })).toHaveAttribute("href", `/api/runs/${ID1}/cv.pdf`);
    expect(within(rows[0]!).getByRole("link", { name: "Download DOCX" })).toHaveAttribute("href", `/api/runs/${ID1}/cv.docx`);
    expect(within(rows[1]!).queryByRole("link", { name: /Download/ })).toBeNull();
  });

  it("Delete confirms, calls DELETE, refreshes the list and toasts", async () => {
    const user = userEvent.setup();
    serveAccount(ADA);
    let runs = [summary(), summary({ id: ID2, jobTitle: "Other" })];
    server.use(http.get("/api/runs", () => HttpResponse.json({ runs })));
    let deleted = 0;
    server.use(
      http.delete(`/api/runs/${ID1}`, () => {
        deleted += 1;
        runs = runs.filter((r) => r.id !== ID1);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp("/runs");
    await user.click(await screen.findByRole("button", { name: "Delete Backend Engineer" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this Run?" });
    await expectNoSeriousViolations(dialog);
    expect(deleted).toBe(0);
    await user.click(within(dialog).getByRole("button", { name: "Delete Run" }));
    expect(await screen.findByText("Run deleted.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Backend Engineer")).toBeNull());
    expect(screen.getByText("Other")).toBeInTheDocument();
    expect(deleted).toBe(1);
  });

  it("a failed delete keeps the dialog with a message", async () => {
    const user = userEvent.setup();
    serveAccount(ADA);
    serveMyRuns([summary()]);
    server.use(http.delete(`/api/runs/${ID1}`, () => HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 })));
    renderApp("/runs");
    await user.click(await screen.findByRole("button", { name: "Delete Backend Engineer" }));
    await user.click(await screen.findByRole("button", { name: "Delete Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete the Run. Try again.");
  });
});
