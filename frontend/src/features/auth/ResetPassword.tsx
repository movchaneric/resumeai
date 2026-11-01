import { useState } from "react";
import type { FormEvent } from "react";
import { useSearchParams } from "react-router";
import { resetPassword } from "@/api";
import { errorCode, FALLBACK_MESSAGE, RATE_LIMITED_MESSAGE } from "@/features/auth/errors";
import { LinkButton, PageHeading } from "@/features/auth/parts";
import { PasswordField } from "@/features/auth/PasswordField";
import { useTitle } from "@/features/auth/useTitle";
import { MIN_PASSWORD, passwordError } from "@/features/auth/validation";
import { Button } from "@/ui/Button";

type Stage = "form" | "done" | "invalid";

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [stage, setStage] = useState<Stage>(!token || params.get("error") ? "invalid" : "form");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  useTitle(stage === "invalid" ? "Link expired" : stage === "done" ? "Password updated" : "Set a new password");

  const error = touched ? (passwordError(password, "sign-up") ?? serverError) : undefined;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched(true);
    if (passwordError(password, "sign-up")) {
      // The error renders on the next paint; focus the input now.
      e.currentTarget.querySelector<HTMLElement>("input")?.focus();
      return;
    }
    if (!token) return;
    setPending(true);
    setProblem(null);
    try {
      await resetPassword({ newPassword: password, token });
      setStage("done");
    } catch (err) {
      const code = errorCode(err);
      if (code === "INVALID_TOKEN") setStage("invalid");
      else if (code === "PASSWORD_TOO_SHORT") setServerError(`Enter a password of at least ${MIN_PASSWORD} characters.`);
      else setProblem(code === "RATE_LIMITED" ? RATE_LIMITED_MESSAGE : FALLBACK_MESSAGE);
      setPending(false);
    }
  }

  if (stage === "done") {
    return (
      <>
        <PageHeading title="Password updated" focus>
          Sign in with your new password.
        </PageHeading>
        <LinkButton primary to="/sign-in">
          Sign in
        </LinkButton>
      </>
    );
  }
  if (stage === "invalid") {
    return (
      <>
        <PageHeading title="This reset link has expired or was already used" focus={!!token}>
          Ask for a new one.
        </PageHeading>
        <LinkButton primary to="/forgot-password">
          Send a new reset link
        </LinkButton>
      </>
    );
  }
  return (
    <>
      <PageHeading title="Set a new password" />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <PasswordField
          value={password}
          onChange={(v) => (setPassword(v), setServerError(undefined), setProblem(null))}
          onBlur={() => setTouched(true)}
          error={error}
          autoComplete="new-password"
          rule={{ text: `At least ${MIN_PASSWORD} characters`, met: password.length >= MIN_PASSWORD }}
        />
        <Button type="submit" busy={pending}>
          Set new password
        </Button>
        {problem && (
          <p role="alert" className="text-sm text-danger">
            {problem}
          </p>
        )}
      </form>
    </>
  );
}
