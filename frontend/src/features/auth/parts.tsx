import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "@/api";
import { FALLBACK_MESSAGE, RATE_LIMITED_MESSAGE } from "@/features/auth/errors";
import { emailError } from "@/features/auth/validation";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { cx } from "@/ui/cx";

/** The page heading. With `focus`, it takes the focus on mount so a screen reader hears a state change. */
export function PageHeading({ title, children, focus = false }: { title: string; children?: ReactNode; focus?: boolean }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) ref.current?.focus();
  }, [focus]);
  return (
    <div className="flex flex-col gap-1">
      <h1 ref={ref} tabIndex={-1} className="text-[28px] leading-tight outline-none">
        {title}
      </h1>
      {children && <p className="text-fg-2">{children}</p>}
    </div>
  );
}

const LINK_BUTTON = "inline-flex min-h-12 items-center justify-center rounded-btn px-5 text-[15px] font-semibold";

/** A link that looks like a button. */
export function LinkButton({ to, primary = false, children }: { to: string; primary?: boolean; children: ReactNode }) {
  return (
    <Link to={to} className={cx(LINK_BUTTON, primary ? "bg-fg text-surface hover:bg-fg-2" : "bg-surface text-fg ring-1 ring-fg-3 hover:bg-soft")}>
      {children}
    </Link>
  );
}

export function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-semibold text-accent hover:underline">
      {children}
    </Link>
  );
}

export function messageFor(error: unknown): string {
  return error instanceof ApiError && error.code === "RATE_LIMITED" ? RATE_LIMITED_MESSAGE : FALLBACK_MESSAGE;
}

/** A one-field form: validates the email, runs `send`, and shows a server problem under the button. */
export function EmailForm({ initial = "", submit, send, onSent }: { initial?: string; submit: string; send: (email: string) => Promise<void>; onSent: (email: string) => void }) {
  const [email, setEmail] = useState(initial);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const error = touched ? emailError(email) : undefined;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setTouched(true);
    if (emailError(email)) {
      e.currentTarget.querySelector<HTMLElement>("input")?.focus();
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      await send(email.trim());
      onSent(email.trim());
    } catch (err) {
      setProblem(messageFor(err));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <Field label="Email" type="email" autoComplete="email" value={email} error={error} onChange={(e) => (setEmail(e.target.value), setProblem(null))} onBlur={() => setTouched(true)} />
      <Button type="submit" busy={pending}>
        {submit}
      </Button>
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
    </form>
  );
}
