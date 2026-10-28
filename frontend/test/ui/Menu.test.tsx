import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Menu } from "@/ui/Menu";
import { expectNoSeriousViolations } from "../helpers/axe";

describe("Menu", () => {
  it("opens from an icon button with an accessible name and selects an item", async () => {
    const onSelect = vi.fn();
    render(<Menu label="Run options" items={[{ label: "Copy link", onSelect }, { label: "Delete Run", onSelect: () => {}, tone: "danger" }]} />);
    const trigger = screen.getByRole("button", { name: "Run options" });
    expect(screen.queryByRole("menu")).toBeNull();
    await userEvent.click(trigger);
    const menu = await screen.findByRole("menu");
    await expectNoSeriousViolations(menu);
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("works from the keyboard", async () => {
    const onSelect = vi.fn();
    render(<Menu label="Run options" items={[{ label: "Copy link", onSelect }]} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
