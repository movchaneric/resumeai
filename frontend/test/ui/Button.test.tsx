import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/ui/Button";
import { expectNoSeriousViolations } from "../helpers/axe";

describe("Button", () => {
  it("calls onClick and is a button by default type", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("is disabled and marked busy while busy, keeping its label", async () => {
    const onClick = vi.fn();
    render(<Button busy onClick={onClick}>Uploading…</Button>);
    const button = screen.getByRole("button", { name: "Uploading…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders every variant and size without serious accessibility violations", async () => {
    const { container } = render(
      <div>
        <Button>Primary</Button>
        <Button variant="secondary" size="compact">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete Run</Button>
      </div>,
    );
    await expectNoSeriousViolations(container);
  });
});
