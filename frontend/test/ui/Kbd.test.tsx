import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Kbd } from "@/ui/Kbd";
import { expectNoSeriousViolations } from "../helpers/axe";

describe("Kbd", () => {
  it("renders the key in a kbd element", () => {
    render(<Kbd>J</Kbd>);
    expect(screen.getByText("J").tagName).toBe("KBD");
  });

  it("has no serious accessibility violations", async () => {
    const { container } = render(<p>Next Change <Kbd>J</Kbd></p>);
    await expectNoSeriousViolations(container);
  });
});
