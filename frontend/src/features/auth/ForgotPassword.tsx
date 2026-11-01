import { useState } from "react";
import { useSearchParams } from "react-router";
import { requestPasswordReset } from "@/api";
import { safeNext } from "@/features/account";
import { EmailForm, LinkButton, PageHeading, TextLink } from "@/features/auth/parts";
import { useTitle } from "@/features/auth/useTitle";

export function ForgotPassword() {
  useTitle("Reset your password");
  const [params] = useSearchParams();
  const rawNext = params.get("next");
  const signIn = `/sign-in${rawNext ? `?next=${encodeURIComponent(safeNext(rawNext))}` : ""}`;
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo) {
    return (
      <>
        <PageHeading title="Check your email" focus>
          If an account exists for <strong className="font-semibold text-fg">{sentTo}</strong>, we sent a reset link.
        </PageHeading>
        <LinkButton to={signIn}>Back to sign in</LinkButton>
      </>
    );
  }
  return (
    <>
      <PageHeading title="Forgot your password?">Enter your email and we will send a link to set a new one.</PageHeading>
      <EmailForm submit="Send reset link" send={(email) => requestPasswordReset({ email, redirectTo: "/reset-password" })} onSent={setSentTo} />
      <p className="text-center text-sm text-fg-2">
        <TextLink to={signIn}>Back to sign in</TextLink>
      </p>
    </>
  );
}
