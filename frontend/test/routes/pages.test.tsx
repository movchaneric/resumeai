import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectNoSeriousViolations } from "../helpers/axe";
import { appHeader } from "../helpers/account";
import { renderApp } from "../helpers/render";

describe("flow pages and the shell", () => {
  it("opens on Upload with the shell: R mark, name and Sign in", async () => {
    const { container } = renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Tailor your CV to the job you want" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Resume AI/ })).toHaveAttribute("href", "/");
    expect(await within(appHeader()).findByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("button", { name: "Copy link to this Run" })).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await expectNoSeriousViolations(container);
  });
});
