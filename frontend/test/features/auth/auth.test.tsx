import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { renderApp } from "../../helpers/render";

const SOON = "Accounts are coming soon. Enter as a guest for now: everything works without one.";

describe("Sign in", () => {
  it("has the panel, the form, one status region and no axe violations", async () => {
    const { container } = renderApp("/sign-in");
    expect(await screen.findByRole("heading", { level: 1, name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByText("Your CV, tailored to the job. Nothing invented.")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByText("No account needed. Your Run stays at its link for 7 days.")).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });

  it("shows errors on blur, focuses the first error on submit and sets aria", async () => {
    const user = userEvent.setup();
    renderApp("/sign-in");
    const email = await screen.findByLabelText("Email");
    await user.type(email, "nope");
    await user.tab();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Enter a full email address, like name@example.com.");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(email).toHaveFocus();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("a valid submit shows the coming-soon note, and Forgot password shows it too", async () => {
    const user = userEvent.setup();
    renderApp("/sign-in");
    await user.click(await screen.findByRole("button", { name: "Forgot password?" }));
    expect(screen.getByRole("status")).toHaveTextContent(SOON);
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("status")).toHaveTextContent(SOON);
  });

  it("toggles the password without submitting", async () => {
    const user = userEvent.setup();
    renderApp("/sign-in");
    const password = await screen.findByLabelText("Password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(password).not.toHaveAttribute("aria-invalid");
  });

  it("Enter as a guest goes to Upload", async () => {
    const user = userEvent.setup();
    renderApp("/sign-in");
    await user.click(await screen.findByRole("link", { name: "Enter as a guest →" }));
    expect(await screen.findByRole("heading", { name: "Tailor your CV to the job you want" })).toBeInTheDocument();
  });
});

describe("Sign up", () => {
  it("has the panel, the fields, one status region and no axe violations", async () => {
    const { container } = renderApp("/sign-up");
    expect(await screen.findByRole("heading", { level: 1, name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByText("Keep every tailored CV in one place.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("autocomplete", "name");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await expectNoSeriousViolations(container);
  });

  it("requires every field and focuses the name on an empty submit", async () => {
    const user = userEvent.setup();
    renderApp("/sign-up");
    await user.click(await screen.findByRole("button", { name: "Create account" }));
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the live password rule and accepts 10 characters", async () => {
    const user = userEvent.setup();
    renderApp("/sign-up");
    const password = await screen.findByLabelText("Password");
    const rule = screen.getByText("At least 10 characters");
    expect(rule).toHaveAttribute("aria-live", "polite");
    expect(rule).not.toHaveAttribute("role", "status");
    await user.type(password, "123456789");
    expect(rule).not.toHaveTextContent("(met)");
    await user.type(password, "0");
    expect(rule).toHaveTextContent("(met)");
    await user.type(screen.getByLabelText("Name"), "Ada Example");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByRole("status")).toHaveTextContent(SOON);
  });

  it("links to Sign in", async () => {
    const user = userEvent.setup();
    renderApp("/sign-up");
    await user.click(await screen.findByRole("link", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });
});
