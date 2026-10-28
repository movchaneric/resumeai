import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoSeriousViolations } from "../helpers/axe";
import { renderApp } from "../helpers/render";

describe("flow pages and the shell", () => {
  it("opens on Upload with the shell: R mark, name and Sign in", async () => {
    const { container } = renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Tailor your CV to a job" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Resume AI/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("button", { name: "Copy link to this Run" })).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await expectNoSeriousViolations(container);
  });

  it("Sign in and Sign up are placeholders that lead back to Upload as a guest", async () => {
    const user = userEvent.setup();
    const { container } = renderApp("/sign-in");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    await expectNoSeriousViolations(container);
    await user.click(screen.getByRole("link", { name: "Enter as a guest" }));
    expect(await screen.findByRole("heading", { name: "Tailor your CV to a job" })).toBeInTheDocument();
  });

  it("serves /sign-up", async () => {
    const { container } = renderApp("/sign-up");
    expect(await screen.findByRole("heading", { name: "Create an account" })).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });
});
