import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_ID, runView } from "../../fixtures/runViews";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { renderApp, serveRun } from "../../helpers/render";
import { server } from "../../helpers/server";

const PATH = `/runs/${RUN_ID}`;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("Done screen", () => {
  it("shows the title, job line, scores and a green delta for a rise", async () => {
    serveRun(RUN_ID, runView("completed"));
    const { container } = renderApp(PATH);
    expect(await screen.findByRole("heading", { name: "Your tailored CV is ready" })).toBeInTheDocument();
    expect(screen.getByText("Senior Backend Engineer at Northwind Labs · one page")).toBeInTheDocument();
    expect(screen.getByText("54")).toBeInTheDocument();
    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("+18")).toBeInTheDocument();
    expect(screen.getByText("Match Score, before and after")).toBeInTheDocument();
    expect(screen.queryByText(/kept fewer of the Changes/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await expectNoSeriousViolations(container);
  });

  it.each([
    [60, 60, "0"],
    [60, 55, "−5"],
  ])("a delta of %s to %s shows a neutral chip %s and the explanation", async (before, after, chip) => {
    serveRun(RUN_ID, runView("completed", { score: { before, after } }));
    const { container } = renderApp(PATH);
    const caption = await screen.findByText("Match Score, before and after");
    expect(within(caption.parentElement!).getByText(chip)).toBeInTheDocument();
    expect(screen.getByText(/Your Review kept fewer of the Changes, so the score moved less\./)).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });

  it("counts the stat tiles from kept Changes and must-haves", async () => {
    const base = { rationale: "r", evidenceIds: ["b1"], requirementIds: ["r1"] };
    serveRun(
      RUN_ID,
      runView("completed", {
        changes: [
          { ...base, id: "c1", op: "replace", targetItemId: "b1", before: "a", after: "b", status: "accepted" },
          { ...base, id: "c2", op: "replace", targetItemId: "b1", before: "a", after: "b", status: "rejected" },
          { ...base, id: "c3", op: "add", parentId: "exp1", after: "x", status: "revised" },
        ],
      }),
    );
    renderApp(PATH);
    const tile = async (label: string) => (await screen.findByText(label)).parentElement!;
    expect(within(await tile("rewordings kept")).getByText("1")).toBeInTheDocument();
    expect(within(await tile("bullets added")).getByText("1")).toBeInTheDocument();
    expect(within(await tile("must-haves met")).getByText("1/1")).toBeInTheDocument();
  });

  it("links the downloads to the API, disables 'See what changed' and shows the expiry date", async () => {
    serveRun(RUN_ID, runView("completed"));
    renderApp(PATH);
    expect(await screen.findByRole("link", { name: "Download PDF" })).toHaveAttribute("href", `/api/runs/${RUN_ID}/cv.pdf`);
    expect(screen.getByRole("link", { name: "Download PDF" })).toHaveAttribute("download");
    expect(screen.getByRole("link", { name: "Download Word" })).toHaveAttribute("href", `/api/runs/${RUN_ID}/cv.docx`);
    expect(screen.getByText("See what changed (coming soon)")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Tailor for another job" })).toHaveAttribute("href", "/");
    expect(screen.getByText(/^Deleted automatically on .+\.$/)).toBeInTheDocument();
  });

  it("downloads the file through the API and shows no error", async () => {
    const user = userEvent.setup();
    let requests = 0;
    server.use(
      http.get(`/api/runs/${RUN_ID}/cv.pdf`, () => {
        requests += 1;
        return new HttpResponse("pdf", { headers: { "Content-Type": "application/pdf" } });
      }),
    );
    serveRun(RUN_ID, runView("completed"));
    renderApp(PATH);
    await user.click(await screen.findByRole("link", { name: "Download PDF" }));
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    expect(requests).toBe(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a 409 CV_TOO_LONG shows the one-page message", async () => {
    const user = userEvent.setup();
    server.use(http.get(`/api/runs/${RUN_ID}/cv.pdf`, () => HttpResponse.json({ code: "CV_TOO_LONG", message: "too long" }, { status: 409 })));
    serveRun(RUN_ID, runView("completed"));
    const { container } = renderApp(PATH);
    await user.click(await screen.findByRole("link", { name: "Download PDF" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This CV can't fit on one page with your choices.");
    expect(alert).toHaveTextContent("Download it anyway as Word, or start a new Run with a shorter CV.");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    await expectNoSeriousViolations(container);
  });

  it("'Delete this Run now' confirms first, deletes, then goes to Upload", async () => {
    const user = userEvent.setup();
    let deleted = 0;
    server.use(
      http.delete(`/api/runs/${RUN_ID}`, () => {
        deleted += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    serveRun(RUN_ID, runView("completed"));
    renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Delete this Run now" }));
    await screen.findByRole("dialog", { name: "Delete this Run?" });
    expect(deleted).toBe(0);
    await user.click(screen.getByRole("button", { name: "Delete Run" }));
    expect(await screen.findByRole("heading", { name: "Tailor your CV to the job you want" })).toBeInTheDocument();
    expect(deleted).toBe(1);
  });
});
