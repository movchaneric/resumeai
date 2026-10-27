import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Field } from "@/ui/Field";
import { expectNoSeriousViolations } from "../helpers/axe";

describe("Field", () => {
  it("labels the input and shows helper text", async () => {
    render(<Field label="Email" helper="We never share it." />);
    const input = screen.getByLabelText("Email");
    await userEvent.type(input, "a@example.com");
    expect(input).toHaveValue("a@example.com");
    expect(input).toHaveAccessibleDescription("We never share it.");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("links the error to the input and marks it invalid", () => {
    render(<Field label="Email" helper="We never share it." error="Enter a valid email." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a valid email. We never share it.");
  });

  it("renders a textarea when multiline", () => {
    render(<Field multiline label="Job Description" />);
    expect(screen.getByLabelText("Job Description").tagName).toBe("TEXTAREA");
  });

  it("has no serious accessibility violations", async () => {
    const { container } = render(
      <div>
        <Field label="Name" />
        <Field label="Email" error="Enter a valid email." />
        <Field multiline label="Notes" helper="Optional" />
      </div>,
    );
    await expectNoSeriousViolations(container);
  });
});
