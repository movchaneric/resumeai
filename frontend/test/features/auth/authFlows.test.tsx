import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADA, serveAccount, serveAuth } from "../../helpers/account";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { renderApp } from "../../helpers/render";
import { server } from "../../helpers/server";

const authError = (path: string, status: number, code: string) =>
  server.use(http.post(`/api/auth${path}`, () => HttpResponse.json({ code, message: code }, { status })));

async function fillSignIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), "correct horse battery");
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => serveAccount(null));
afterEach(() => vi.unstubAllGlobals());

describe("Sign in, for real", () => {
  it("signs in, refreshes the Account and goes to ?next=", async () => {
    const calls = serveAuth("/sign-in/email", 200, { user: { id: "u1" } });
    const user = userEvent.setup();
    const { router } = renderApp("/sign-in?next=%2Fruns%2Fabc");
    await findForm();
    serveAccount(ADA); // the Account is known once the session cookie is set
    await fillSignIn(user);
    await waitFor(() => expect(router.state.location.pathname).toBe("/runs/abc"));
    expect(calls).toEqual([{ email: "ada@example.com", password: "correct horse battery" }]);
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example"])("a hostile next (%s) lands on /runs", async (hostile) => {
    serveAuth("/sign-in/email", 200, { user: { id: "u1" } });
    const user = userEvent.setup();
    const { router } = renderApp(`/sign-in?next=${encodeURIComponent(hostile)}`);
    await findForm();
    serveAccount(ADA);
    await fillSignIn(user);
    await waitFor(() => expect(router.state.location.pathname).toBe("/runs"));
    expect(router.state.location.search).toBe("");
  });

  it("defaults to /runs without next", async () => {
    serveAuth("/sign-in/email", 200, { user: { id: "u1" } });
    const user = userEvent.setup();
    const { router } = renderApp("/sign-in");
    await findForm();
    serveAccount(ADA);
    await fillSignIn(user);
    await waitFor(() => expect(router.state.location.pathname).toBe("/runs"));
  });

  it("a signed-in visitor goes straight to next", async () => {
    serveAccount(ADA);
    const { router } = renderApp("/sign-up?next=%2Fruns%2Fabc");
    await waitFor(() => expect(router.state.location.pathname).toBe("/runs/abc"));
  });

  it("keeps next on the footer link and Forgot password?", async () => {
    renderApp("/sign-in?next=%2Fruns%2Fabc");
    expect(await screen.findByRole("link", { name: "Create an account" })).toHaveAttribute("href", "/sign-up?next=%2Fruns%2Fabc");
    expect(screen.getByRole("link", { name: "Forgot password?" })).toHaveAttribute("href", "/forgot-password?next=%2Fruns%2Fabc");
  });

  it("shows wrong email or password inline, with axe clean", async () => {
    authError("/sign-in/email", 401, "INVALID_EMAIL_OR_PASSWORD");
    const user = userEvent.setup();
    const { container } = renderApp("/sign-in");
    await fillSignIn(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    await expectNoSeriousViolations(container);
  });

  it("offers to send the link again when the email is not verified", async () => {
    authError("/sign-in/email", 403, "EMAIL_NOT_VERIFIED");
    const resend = serveAuth("/send-verification-email");
    const user = userEvent.setup();
    const { container } = renderApp("/sign-in?next=%2Fruns%2Fabc");
    await fillSignIn(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("isn't verified yet");
    await user.click(screen.getByRole("button", { name: "Send the link again" }));
    expect(await screen.findByText("We sent the link again. Check your inbox.")).toBeInTheDocument();
    expect(resend).toEqual([{ email: "ada@example.com", callbackURL: "/verify-email?next=%2Fruns%2Fabc" }]);
    expect(screen.queryByRole("alert")).toBeNull();
    await expectNoSeriousViolations(container);
  });

  it("says so when rate limited, and for anything else", async () => {
    server.use(http.post("/api/auth/sign-in/email", () => HttpResponse.json({ message: "slow down" }, { status: 429 })));
    const user = userEvent.setup();
    renderApp("/sign-in");
    await fillSignIn(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries");
    authError("/sign-in/email", 500, "INTERNAL");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Try again."));
  });

  it("disables the button while the request is pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    server.use(
      http.post("/api/auth/sign-in/email", async () => {
        await gate;
        return HttpResponse.json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "x" }, { status: 401 });
      }),
    );
    const user = userEvent.setup();
    renderApp("/sign-in");
    await fillSignIn(user);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
  });
});

async function findForm() {
  await screen.findByLabelText("Email");
}

describe("Google", () => {
  it("asks the social endpoint and assigns the returned URL", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, origin: window.location.origin });
    const calls = serveAuth("/sign-in/social", 200, { url: "https://accounts.example/authorize?x=1" });
    const user = userEvent.setup();
    renderApp("/sign-in?next=%2Fruns%2Fabc");
    await user.click(await screen.findByRole("button", { name: "Continue with Google" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.example/authorize?x=1"));
    expect(calls).toEqual([
      { provider: "google", callbackURL: "/runs/abc", newUserCallbackURL: "/runs/abc", errorCallbackURL: "/sign-in?next=%2Fruns%2Fabc" },
    ]);
  });

  it("shows an error when Google cannot be started", async () => {
    authError("/sign-in/social", 500, "INTERNAL");
    const user = userEvent.setup();
    renderApp("/sign-up");
    await user.click(await screen.findByRole("button", { name: "Continue with Google" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't sign in with Google.");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  });

  it.each(["account_not_linked", "email_not_verified", "unable_to_link_account"])("explains %s", async (code) => {
    const { container } = renderApp(`/sign-in?error=${code}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("This email has an account that isn't verified yet. Open the link we emailed you, then continue with Google.");
    await expectNoSeriousViolations(container);
  });

  it("uses the plain line for any other error", async () => {
    renderApp("/sign-in?error=access_denied");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't sign in with Google. Try again, or use your email and password.");
  });
});

describe("Sign up, for real", () => {
  async function fillSignUp(user: ReturnType<typeof userEvent.setup>, password = "correct horse battery") {
    await user.type(await screen.findByLabelText("Name"), "Ada Example");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), password);
    await user.click(screen.getByRole("button", { name: "Create account" }));
  }

  it("goes to check-email with the email and next", async () => {
    const calls = serveAuth("/sign-up/email", 200, { user: { id: "u1" } });
    const user = userEvent.setup();
    const { router } = renderApp("/sign-up?next=%2Fruns%2Fabc");
    await fillSignUp(user);
    await waitFor(() => expect(router.state.location.pathname).toBe("/check-email"));
    expect(router.state.location.search).toBe("?email=ada%40example.com&next=%2Fruns%2Fabc");
    expect(calls).toEqual([{ name: "Ada Example", email: "ada@example.com", password: "correct horse battery", callbackURL: "/verify-email?next=%2Fruns%2Fabc" }]);
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
  });

  it("maps PASSWORD_TOO_SHORT to the password field", async () => {
    authError("/sign-up/email", 400, "PASSWORD_TOO_SHORT");
    const user = userEvent.setup();
    renderApp("/sign-up");
    await fillSignUp(user);
    const password = screen.getByLabelText("Password");
    await waitFor(() => expect(password).toHaveAttribute("aria-invalid", "true"));
    expect(password).toHaveAccessibleDescription(/Enter a password of at least 10 characters/);
    expect(password).toHaveFocus();
  });

  it("shows the fallback problem for other failures", async () => {
    authError("/sign-up/email", 500, "INTERNAL");
    const user = userEvent.setup();
    renderApp("/sign-up");
    await fillSignUp(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  });
});

describe("Check email", () => {
  it("names the address, resends, and links back to sign in", async () => {
    const resend = serveAuth("/send-verification-email");
    const user = userEvent.setup();
    const { container } = renderApp("/check-email?email=ada%40example.com&next=%2Fruns%2Fabc");
    expect(await screen.findByRole("heading", { level: 1, name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?next=%2Fruns%2Fabc");
    await user.click(screen.getByRole("button", { name: "Send it again" }));
    expect(await screen.findByText("We sent the link again. Check your inbox.")).toBeInTheDocument();
    expect(resend).toEqual([{ email: "ada@example.com", callbackURL: "/verify-email?next=%2Fruns%2Fabc" }]);
    await expectNoSeriousViolations(container);
  });

  it("is plain without an email", async () => {
    const { container } = renderApp("/check-email");
    expect(await screen.findByRole("heading", { level: 1, name: "Check your email" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send it again" })).toBeNull();
    await expectNoSeriousViolations(container);
  });

  it("shows a problem when the resend fails", async () => {
    authError("/send-verification-email", 500, "INTERNAL");
    const user = userEvent.setup();
    renderApp("/check-email?email=ada%40example.com");
    await user.click(await screen.findByRole("button", { name: "Send it again" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  });
});

describe("Verify email", () => {
  it("confirms and links to sign in with next", async () => {
    const { container } = renderApp("/verify-email?next=%2Fruns%2Fabc");
    expect(await screen.findByRole("heading", { level: 1, name: "Email verified" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in?next=%2Fruns%2Fabc");
    await expectNoSeriousViolations(container);
  });

  it.each(["TOKEN_EXPIRED", "INVALID_TOKEN", "USER_NOT_FOUND"])("%s offers a new link", async (code) => {
    const resend = serveAuth("/send-verification-email");
    const user = userEvent.setup();
    const { container } = renderApp(`/verify-email?error=${code}`);
    expect(await screen.findByRole("heading", { level: 1, name: "This link has expired or was already used" })).toBeInTheDocument();
    await expectNoSeriousViolations(container);
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send a new link" }));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(resend).toEqual([{ email: "ada@example.com", callbackURL: "/verify-email?next=%2Fruns" }]);
  });

  it("validates the email first", async () => {
    const user = userEvent.setup();
    renderApp("/verify-email?error=TOKEN_EXPIRED");
    await user.click(await screen.findByRole("button", { name: "Send a new link" }));
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });
});

describe("Forgot password", () => {
  it("always answers the same, and sends the reset link to /reset-password", async () => {
    const calls = serveAuth("/request-password-reset");
    const user = userEvent.setup();
    const { container } = renderApp("/forgot-password");
    expect(await screen.findByRole("heading", { level: 1, name: "Forgot your password?" })).toBeInTheDocument();
    await expectNoSeriousViolations(container);
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText(/we sent a reset link\./)).toHaveTextContent("If an account exists for ada@example.com, we sent a reset link.");
    expect(calls).toEqual([{ email: "ada@example.com", redirectTo: "/reset-password" }]);
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/sign-in");
  });

  it("shows a problem when the request fails", async () => {
    authError("/request-password-reset", 500, "INTERNAL");
    const user = userEvent.setup();
    renderApp("/forgot-password");
    await user.type(await screen.findByLabelText("Email"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
  });
});

describe("Reset password", () => {
  it("sets the new password and offers Sign in", async () => {
    const calls = serveAuth("/reset-password");
    const user = userEvent.setup();
    const { container } = renderApp("/reset-password?token=tok123");
    const field = await screen.findByLabelText("Password");
    expect(screen.getByText("At least 10 characters")).toBeInTheDocument();
    await expectNoSeriousViolations(container);
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(field).toHaveAttribute("type", "text");
    await user.type(field, "a brand new password");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Password updated" })).toBeInTheDocument();
    expect(calls).toEqual([{ newPassword: "a brand new password", token: "tok123" }]);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  });

  it("checks the length on the client", async () => {
    const user = userEvent.setup();
    renderApp("/reset-password?token=tok123");
    await user.type(await screen.findByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Password")).toHaveFocus();
  });

  it("maps a server PASSWORD_TOO_SHORT to the field", async () => {
    authError("/reset-password", 400, "PASSWORD_TOO_SHORT");
    const user = userEvent.setup();
    renderApp("/reset-password?token=tok123");
    await user.type(await screen.findByLabelText("Password"), "long enough here");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    await waitFor(() => expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true"));
  });

  it("an INVALID_TOKEN on submit shows the expired state", async () => {
    authError("/reset-password", 400, "INVALID_TOKEN");
    const user = userEvent.setup();
    renderApp("/reset-password?token=old");
    await user.type(await screen.findByLabelText("Password"), "long enough here");
    await user.click(screen.getByRole("button", { name: "Set new password" }));
    expect(await screen.findByRole("heading", { level: 1, name: "This reset link has expired or was already used" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send a new reset link" })).toHaveAttribute("href", "/forgot-password");
  });

  it.each(["/reset-password?error=INVALID_TOKEN", "/reset-password", "/reset-password?token=abc&error=INVALID_TOKEN"])("%s shows the expired state", async (path) => {
    const { container } = renderApp(path);
    expect(await screen.findByRole("heading", { level: 1, name: "This reset link has expired or was already used" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send a new reset link" })).toHaveAttribute("href", "/forgot-password");
    await expectNoSeriousViolations(container);
  });
});
