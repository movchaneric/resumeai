import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { RunIdSchema } from "@resume-ai/shared";
import { runKey } from "@/features/run/useRun";
import { runView } from "../../fixtures/runViews";
import { ADA, appHeader, serveAccount, serveMyRuns } from "../../helpers/account";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { renderApp } from "../../helpers/render";
import { server } from "../../helpers/server";

const run = (n: number) => ({
  id: RunIdSchema.parse(`0b7e6f8e-1c2d-4e5f-8a9b-0c1d2e3f4a${String(n).padStart(2, "0")}`),
  status: "completed" as const,
  createdAt: "2026-11-01T10:00:00.000Z",
  jobTitle: "Engineer",
  company: "Acme",
  matchScore: 70,
});

const banner = appHeader;

describe("header, signed out", () => {
  it("shows Sign in to /sign-in with no next on /", async () => {
    const { container } = renderApp("/");
    expect(await within(banner()).findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    await expectNoSeriousViolations(container);
  });

  it("carries the current path and search as next", async () => {
    renderApp("/somewhere?a=1");
    const link = await within(banner()).findByRole("link", { name: "Sign in" });
    const url = new URL(link.getAttribute("href")!, "http://x");
    expect(url.pathname).toBe("/sign-in");
    expect(url.searchParams.get("next")).toBe("/somewhere?a=1");
  });
});

describe("header, signed in", () => {
  it("shows neither Sign in nor the menu while the Account is pending", async () => {
    server.use(http.get("/api/account", () => new Promise<Response>(() => {})));
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Tailor your CV to the job you want" });
    expect(within(banner()).queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(within(banner()).queryByRole("button")).toBeNull();
  });

  it("shows the initial when there is no picture, and a menu with three items", async () => {
    const user = userEvent.setup();
    serveAccount(ADA);
    const { container } = renderApp("/");
    const trigger = await within(banner()).findByRole("button", { name: /Account menu/ });
    expect(trigger).toHaveTextContent("A");
    expect(trigger).toHaveTextContent("Ada Example");
    expect(within(banner()).queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(trigger.querySelector("img")).toBeNull();
    await user.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "My Runs" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete account" })).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });

  it("shows the Google picture with no referrer", async () => {
    serveAccount({ ...ADA, image: "https://pictures.example.com/ada.png" });
    renderApp("/");
    const trigger = await within(banner()).findByRole("button", { name: /Account menu/ });
    const img = trigger.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://pictures.example.com/ada.png");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("does not fetch My Runs until the delete dialog opens", async () => {
    let fetched = 0;
    serveAccount(ADA);
    server.use(
      http.get("/api/runs", () => {
        fetched += 1;
        return HttpResponse.json({ runs: [] });
      }),
    );
    renderApp("/");
    await within(banner()).findByRole("button", { name: /Account menu/ });
    await new Promise((r) => setTimeout(r, 50));
    expect(fetched).toBe(0);
  });

  it("My Runs goes to /runs", async () => {
    const user = userEvent.setup();
    serveAccount(ADA);
    serveMyRuns([]);
    const { router } = renderApp("/");
    await user.click(await within(banner()).findByRole("button", { name: /Account menu/ }));
    await user.click(await screen.findByRole("menuitem", { name: "My Runs" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/runs"));
  });
});

describe("sign out", () => {
  it("signs out, goes to / and shows Sign in", async () => {
    const user = userEvent.setup();
    serveAccount(ADA);
    let calls = 0;
    server.use(
      http.post("/api/auth/sign-out", () => {
        calls += 1;
        return HttpResponse.json({ success: true });
      }),
    );
    const { router } = renderApp("/somewhere");
    await user.click(await within(banner()).findByRole("button", { name: /Account menu/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(await within(banner()).findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(calls).toBe(1);
    expect(router.state.location.pathname).toBe("/");
  });

  it("drops every cached server answer, so the next person sees none of it", async () => {
    const user = userEvent.setup();
    serveAccount(ADA);
    server.use(http.post("/api/auth/sign-out", () => HttpResponse.json({ success: true })));
    const { client } = renderApp("/");
    const view = runView("completed");
    client.setQueryData(runKey(view.id), view);
    await user.click(await within(banner()).findByRole("button", { name: /Account menu/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(await within(banner()).findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(client.getQueryData(runKey(view.id))).toBeUndefined();
    expect(client.getQueryData(["account"])).toBeNull();
  });

  it("a failure shows a toast and stays signed in", async () => {
    const user = userEvent.setup();
    serveAccount(ADA);
    server.use(http.post("/api/auth/sign-out", () => HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: 500 })));
    renderApp("/somewhere");
    await user.click(await within(banner()).findByRole("button", { name: /Account menu/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByText("Couldn't sign out. Try again.")).toBeInTheDocument();
    expect(within(banner()).getByRole("button", { name: /Account menu/ })).toBeInTheDocument();
  });
});

describe("delete account", () => {
  async function openDialog(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await within(banner()).findByRole("button", { name: /Account menu/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Delete account" }));
    return screen.findByRole("dialog", { name: "Delete your account?" });
  }

  it.each([
    [[], "Deletes your account and all 0 Runs. This can't be undone."],
    [[run(1)], "Deletes your account and all 1 Run. This can't be undone."],
    [[run(1), run(2), run(3)], "Deletes your account and all 3 Runs. This can't be undone."],
  ])("counts the Runs (%#)", async (runs, text) => {
    const user = userEvent.setup();
    serveAccount(ADA);
    serveMyRuns(runs);
    renderApp("/");
    const dialog = await openDialog(user);
    await waitFor(() => expect(dialog).toHaveTextContent(text));
    await expectNoSeriousViolations(dialog);
  });

  it("says 'all your Runs' while the count loads", async () => {
    const user = userEvent.setup();
    serveAccount(ADA);
    server.use(http.get("/api/runs", () => new Promise<Response>(() => {})));
    renderApp("/");
    const dialog = await openDialog(user);
    expect(dialog).toHaveTextContent("Deletes your account and all your Runs. This can't be undone.");
  });

  it("RUN_BUSY shows the inline message and keeps the dialog", async () => {
    const user = userEvent.setup();
    serveAccount(ADA);
    serveMyRuns([]);
    server.use(http.delete("/api/account", () => HttpResponse.json({ code: "RUN_BUSY", message: "busy" }, { status: 409 })));
    renderApp("/");
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("A Run is still working. Try again when it finishes.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("success clears the session, goes to / and toasts", async () => {
    const user = userEvent.setup();
    serveAccount(ADA);
    serveMyRuns([]);
    let calls = 0;
    server.use(
      http.delete("/api/account", () => {
        calls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { router } = renderApp("/somewhere");
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Delete account" }));
    expect(await screen.findByText("Account deleted.")).toBeInTheDocument();
    expect(calls).toBe(1);
    expect(router.state.location.pathname).toBe("/");
    expect(await within(banner()).findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
