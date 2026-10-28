import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Chip } from "@/ui/Chip";
import { expectNoSeriousViolations } from "../helpers/axe";

describe("Chip", () => {
  it("renders text as a plain span without onClick", () => {
    render(<Chip variant="delta">+16</Chip>);
    expect(screen.getByText("+16").tagName).toBe("SPAN");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders a button that opens details when clickable", async () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>Fits one page</Chip>);
    await userEvent.click(screen.getByRole("button", { name: "Fits one page" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("has no serious accessibility violations", async () => {
    const { container } = render(
      <div>
        <Chip>Match Score 82</Chip>
        <Chip variant="badge">Rewording</Chip>
        <Chip variant="warn">3 lines over one page</Chip>
        <Chip onClick={() => {}}>Details</Chip>
      </div>,
    );
    await expectNoSeriousViolations(container);
  });
});
