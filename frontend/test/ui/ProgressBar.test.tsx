import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "@/ui/ProgressBar";
import { expectNoSeriousViolations } from "../helpers/axe";

describe("ProgressBar", () => {
  it("exposes its name and values", () => {
    render(<ProgressBar label="Tailoring progress" value={2} max={3} />);
    const bar = screen.getByRole("progressbar", { name: "Tailoring progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "2");
    expect(bar).toHaveAttribute("aria-valuemax", "3");
  });

  it("clamps the value into range", () => {
    render(<ProgressBar label="p" value={150} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("has no serious accessibility violations", async () => {
    const { container } = render(<ProgressBar label="Progress" value={40} />);
    await expectNoSeriousViolations(container);
  });
});
