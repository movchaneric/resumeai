import { useState } from "react";
import { useSearchParams } from "react-router";
import { sendVerificationEmail } from "@/api";
import { safeNext } from "@/features/account";
import { EmailForm, LinkButton, PageHeading } from "@/features/auth/parts";
import { useTitle } from "@/features/auth/useTitle";

/** Where the emailed verification link lands. It does not sign anyone in, so the next step is "Sign in". */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const failed = params.get("error") !== null;
  const next = safeNext(params.get("next"));
  const [resent, setResent] = useState<string | null>(null);
  useTitle(failed ? "Link expired" : "Email verified");

  if (!failed) {
    return (
      <>
        <PageHeading title="Email verified">You can sign in now.</PageHeading>
        <LinkButton primary to={`/sign-in?next=${encodeURIComponent(next)}`}>
          Sign in
        </LinkButton>
      </>
    );
  }
  if (resent) {
    return (
      <>
        <PageHeading title="Check your email" focus>
          If {resent} needs verifying, we sent a new link.
        </PageHeading>
        <LinkButton to={`/sign-in?next=${encodeURIComponent(next)}`}>Back to sign in</LinkButton>
      </>
    );
  }
  return (
    <>
      <PageHeading title="This link has expired or was already used">Enter your email and we will send a new one.</PageHeading>
      <EmailForm
        submit="Send a new link"
        send={(email) => sendVerificationEmail({ email, callbackURL: `/verify-email?next=${encodeURIComponent(next)}` })}
        onSent={setResent}
      />
    </>
  );
}
