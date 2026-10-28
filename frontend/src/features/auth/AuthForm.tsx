import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { PasswordField } from "@/features/auth/PasswordField";
import { emailError, MIN_PASSWORD, nameError, passwordError } from "@/features/auth/validation";

const COMING_SOON = "Accounts are coming soon. Enter as a guest for now: everything works without one.";

type FieldName = "name" | "email" | "password";
type Mode = "sign-in" | "sign-up";

const TEXT = {
  "sign-in": { title: "Welcome back", subtitle: "Sign in to see your Runs.", submit: "Sign in" },
  "sign-up": { title: "Create your account", subtitle: "Free. Takes a minute.", submit: "Create account" },
} as const;

/** UI only: validates on the client; a valid submit shows a note. No network call, nothing stored. */
export function AuthForm({ mode }: { mode: Mode }) {
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [note, setNote] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const all: Record<FieldName, string | undefined> = {
    name: mode === "sign-up" ? nameError(values.name) : undefined,
    email: emailError(values.email),
    password: passwordError(values.password, mode),
  };
  const shown = (f: FieldName) => (touched[f] ? all[f] : undefined);

  // Move focus once the errors from a submit are rendered.
  useEffect(() => {
    if (focusTick > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const set = (f: FieldName) => (v: string) => {
    setValues((s) => ({ ...s, [f]: v }));
    setNote(false);
  };
  const blur = (f: FieldName) => () => setTouched((t) => ({ ...t, [f]: true }));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true });
    if (Object.values(all).some(Boolean)) {
      setNote(false);
      setFocusTick((n) => n + 1);
    } else {
      setNote(true);
    }
  }

  const text = TEXT[mode];
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight">{text.title}</h1>
        <p className="text-fg-2">{text.subtitle}</p>
      </div>
      <form ref={formRef} onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {mode === "sign-up" && (
          <Field label="Name" type="text" autoComplete="name" value={values.name} error={shown("name")} onChange={(e) => set("name")(e.target.value)} onBlur={blur("name")} />
        )}
        <Field label="Email" type="email" autoComplete="email" value={values.email} error={shown("email")} onChange={(e) => set("email")(e.target.value)} onBlur={blur("email")} />
        <PasswordField
          value={values.password}
          onChange={set("password")}
          onBlur={blur("password")}
          error={shown("password")}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          labelAction={
            mode === "sign-in" ? (
              <button type="button" onClick={() => setNote(true)} className="rounded-sm text-sm font-semibold text-accent hover:underline">
                Forgot password?
              </button>
            ) : undefined
          }
          rule={mode === "sign-up" ? { text: `At least ${MIN_PASSWORD} characters`, met: values.password.length >= MIN_PASSWORD } : undefined}
        />
        <Button type="submit">{text.submit}</Button>
        <p role="status" className="text-sm text-fg-2">
          {note ? COMING_SOON : ""}
        </p>
      </form>
      <div className="flex items-center gap-3 text-sm text-fg-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="flex flex-col gap-2">
        <Link
          to="/"
          className="inline-flex min-h-12 items-center justify-center rounded-btn bg-surface px-5 text-[15px] font-semibold text-fg ring-1 ring-fg-3 hover:bg-soft"
        >
          Enter as a guest →
        </Link>
        <p className="text-center text-[13px] text-fg-3">No account needed. Your Run stays at its link for 7 days.</p>
      </div>
      <p className="text-center text-sm text-fg-2">
        {mode === "sign-in" ? "New here? " : "Already have an account? "}
        <Link to={mode === "sign-in" ? "/sign-up" : "/sign-in"} className="font-semibold text-accent hover:underline">
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </>
  );
}
