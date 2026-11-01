import { useState } from "react";
import { useSearchParams } from "react-router";
import { sendVerificationEmail } from "@/api";
import { safeNext } from "@/features/account";
import { messageFor, PageHeading, TextLink } from "@/features/auth/parts";
import { useTitle } from "@/features/auth/useTitle";
import { Button } from "@/ui/Button";

export function CheckEmail() {
  useTitle("Check your email");
  const [params] = useSearchParams();
  const email = params.get("email")?.trim() || null;
  const next = safeNext(params.get("next"));
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function resend() {
    if (!email) return;
    setPending(true);
    setProblem(null);
    setSent(false);
    try {
      await sendVerificationEmail({ email, callbackURL: `/verify-email?next=${encodeURIComponent(next)}` });
      setSent(true);
    } catch (error) {
      setProblem(messageFor(error));
    }
    setPending(false);
  }

  return (
    <>
      <PageHeading title="Check your email">
        {email ? (
          <>
            We sent a link to <strong className="font-semibold text-fg">{email}</strong>. Open it to finish signing up.
          </>
        ) : (
          "We sent you a link. Open it to finish signing up."
        )}
      </PageHeading>
      {email && (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" busy={pending} onClick={resend}>
            Send it again
          </Button>
          {problem && (
            <p role="alert" className="text-sm text-danger">
              {problem}
            </p>
          )}
          <p role="status" className="text-sm text-fg-2">
            {sent ? "We sent the link again. Check your inbox." : ""}
          </p>
        </div>
      )}
      <p className="text-center text-sm text-fg-2">
        Already verified? <TextLink to={`/sign-in?next=${encodeURIComponent(next)}`}>Sign in</TextLink>
      </p>
    </>
  );
}
