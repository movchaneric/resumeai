import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { expectNoSeriousViolations } from "../helpers/axe";

const base = { title: "Delete this Run?", description: "It can't be undone.", confirmLabel: "Delete Run", busyLabel: "Deleting…", onOpenChange: () => {}, onConfirm: () => {} };

describe("ConfirmDialog", () => {
  it("renders nothing while closed", () => {
    render(<ConfirmDialog {...base} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is an accessible dialog with a title and description, and confirms and cancels", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...base} open onConfirm={onConfirm} onOpenChange={onOpenChange} />);
    const dialog = screen.getByRole("dialog", { name: "Delete this Run?" });
    expect(dialog).toHaveAccessibleDescription("It can't be undone.");
    await expectNoSeriousViolations(dialog);
    await userEvent.click(screen.getByRole("button", { name: "Delete Run" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes on Escape", async () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...base} open onOpenChange={onOpenChange} />);
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the busy label, disables both buttons and ignores Escape while busy", async () => {
    const onOpenChange = vi.fn();
    render(<ConfirmDialog {...base} open busy onOpenChange={onOpenChange} />);
    expect(screen.getByRole("button", { name: "Deleting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("announces an error", () => {
    render(<ConfirmDialog {...base} open error="Couldn't delete the Run. Try again." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't delete the Run. Try again.");
  });
});
