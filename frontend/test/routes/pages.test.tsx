import { screen } from "@testing-library/react";
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
});
