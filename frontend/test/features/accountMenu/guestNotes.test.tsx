import { screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { RUN_ID } from "../../fixtures/runViews";
import { ADA, serveAccount } from "../../helpers/account";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { renderApp } from "../../helpers/render";
import { server } from "../../helpers/server";

const NOTE = /As a guest, this Run stays at its link for 7 days\./;

describe("Upload guest note", () => {
  it("shows for a guest, linking to /sign-in", async () => {
    const { container } = renderApp("/");
    const note = await screen.findByText(NOTE);
    expect(note).toHaveTextContent("As a guest, this Run stays at its link for 7 days. Sign in to keep it in My Runs.");
    expect(note.querySelector("a")).toHaveAttribute("href", "/sign-in");
    await expectNoSeriousViolations(container);
  });

  it("is absent when signed in", async () => {
    serveAccount(ADA);
    renderApp("/");
    await screen.findByRole("button", { name: /Account menu/ });
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("is absent while the Account is pending", async () => {
    server.use(http.get("/api/account", () => new Promise<Response>(() => {})));
    renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Tailor your CV to the job you want" });
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe("Run not found: sign-in line", () => {
  const notFound = () => server.use(http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json({ code: "RUN_NOT_FOUND", message: "x" }, { status: 404 })));

  it("shows for a guest, linking back to the Run after sign-in", async () => {
    notFound();
    const { container } = renderApp(`/runs/${RUN_ID}`);
    const link = await screen.findByRole("link", { name: "sign in" });
    expect(link).toHaveAttribute("href", `/sign-in?next=/runs/${RUN_ID}`);
    expect(link.parentElement).toHaveTextContent("If this is your Run, sign in to open it");
    await expectNoSeriousViolations(container);
  });

  it("is absent when signed in", async () => {
    notFound();
    serveAccount(ADA);
    renderApp(`/runs/${RUN_ID}`);
    await screen.findByText("This Run doesn't exist or has expired");
    await screen.findByRole("button", { name: /Account menu/ });
    expect(screen.queryByRole("link", { name: "sign in" })).toBeNull();
  });

  it("is absent on an unknown path", async () => {
    renderApp("/nope");
    await screen.findByText("This Run doesn't exist or has expired");
    await waitFor(() => expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: "sign in" })).toBeNull();
  });
});
