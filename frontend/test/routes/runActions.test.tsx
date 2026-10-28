import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { RUN_ID, runView } from "../fixtures/runViews";
import { expectNoSeriousViolations } from "../helpers/axe";
import { renderApp, serveRun } from "../helpers/render";
import { server } from "../helpers/server";

const PATH = `/runs/${RUN_ID}`;

describe("Run actions in the header", () => {
  it("'Copy link to this Run' copies the URL and says 'Link copied'", async () => {
    const user = userEvent.setup();
    serveRun(RUN_ID, runView("awaiting_review"));
    renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Copy link to this Run" }));
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(window.location.href);
  });

  it("the ⋯ menu offers Copy link and Delete Run", async () => {
    const user = userEvent.setup();
    serveRun(RUN_ID, runView("awaiting_review"));
    renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Run options" }));
    expect(await screen.findByRole("menuitem", { name: "Copy link" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete Run" })).toBeInTheDocument();
  });

  it("Delete Run confirms in a dialog, calls DELETE, then goes to Upload", async () => {
    const user = userEvent.setup();
    serveRun(RUN_ID, runView("awaiting_review"));
    let deleted = 0;
    server.use(
      http.delete(`/api/runs/${RUN_ID}`, () => {
        deleted += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { router } = renderApp(PATH);

    await user.click(await screen.findByRole("button", { name: "Run options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete Run" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this Run?" });
    await expectNoSeriousViolations(dialog);
    expect(deleted).toBe(0);

    await user.click(screen.getByRole("button", { name: "Delete Run" }));
    expect(await screen.findByRole("heading", { name: "Tailor your CV to a job" })).toBeInTheDocument();
    expect(deleted).toBe(1);
    expect(router.state.location.pathname).toBe("/");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancel closes the dialog without deleting", async () => {
    const user = userEvent.setup();
    serveRun(RUN_ID, runView("awaiting_review"));
    let deleted = 0;
    server.use(http.delete(`/api/runs/${RUN_ID}`, () => { deleted += 1; return new HttpResponse(null, { status: 204 }); }));
    renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Run options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete Run" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleted).toBe(0);
    expect(screen.getByRole("heading", { name: "Review your Changes" })).toBeInTheDocument();
  });

  it("a failed delete keeps the dialog open with a message", async () => {
    const user = userEvent.setup();
    serveRun(RUN_ID, runView("awaiting_review"));
    server.use(http.delete(`/api/runs/${RUN_ID}`, () => HttpResponse.json({ code: "INTERNAL", message: "Something went wrong." }, { status: 500 })));
    renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Run options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete Run" }));
    await user.click(await screen.findByRole("button", { name: "Delete Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete the Run. Try again.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
