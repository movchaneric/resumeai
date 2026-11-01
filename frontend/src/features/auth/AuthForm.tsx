import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { sendVerificationEmail, signInWithEmail, signUpWithEmail } from "@/api";
import { safeNext, useAccountActions } from "@/features/account";
import { GoogleButton } from "@/features/auth/GoogleButton";
import { PasswordField } from "@/features/auth/PasswordField";
import { emailError, MIN_PASSWORD, nameError, passwordError } from "@/features/auth/validation";
import { errorCode, FALLBACK_MESSAGE, GOOGLE_FAILED_MESSAGE, googleErrorMessage, RATE_LIMITED_MESSAGE } from "@/features/auth/errors";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";

type FieldName = "name" | "email" | "password";
type Mode = "sign-in" | "sign-up";

const TEXT = {
  "sign-in": { title: "Welcome back", subtitle: "Sign in to see your Runs.", submit: "Sign in" },
  "sign-up": { title: "Create your account", subtitle: "Free. Takes a minute.", submit: "Create account" },
} as const;

type Problem = "credentials" | "unverified" | "rate" | "other";

const PROBLEM_TEXT: Record<Problem, string> = {
  credentials: "Wrong email or password.",
  unverified: "This email isn't verified yet. Open the link we emailed you, or ask for a new one.",
  rate: RATE_LIMITED_MESSAGE,
  other: FALLBACK_MESSAGE,
};

function problemOf(error: unknown, mode: Mode): Problem {
  const code = errorCode(error);
  if (code === "RATE_LIMITED") return "rate";
  if (mode === "sign-in" && code === "INVALID_EMAIL_OR_PASSWORD") return "credentials";
  if (mode === "sign-in" && code === "EMAIL_NOT_VERIFIED") return "unverified";
  return "other";
}

export function AuthForm({ mode }: { mode: Mode }) {
  const [params] = useSearchParams();
  const rawNext = params.get("next");
  const next = safeNext(rawNext);
  const nextQuery = rawNext ? `?next=${encodeURIComponent(next)}` : "";
  const navigate = useNavigate();
  const { refresh } = useAccountActions();

  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [serverPassword, setServerPassword] = useState<string>();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [googleMessage, setGoogleMessage] = useState<string | null>(() => (mode === "sign-in" ? googleErrorMessage(params.get("error")) : null));
  const [pending, setPending] = useState(false);
  const [resent, setResent] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  const all: Record<FieldName, string | undefined> = {
    name: mode === "sign-up" ? nameError(values.name) : undefined,
    email: emailError(values.email),
    password: passwordError(values.password, mode),
  };
  const shown = (f: FieldName) => (touched[f] ? (all[f] ?? (f === "password" ? serverPassword : undefined)) : undefined);

  // Move focus once the errors from a submit are rendered.
  useEffect(() => {
    if (focusTick > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  const set = (f: FieldName) => (v: string) => {
    setValues((s) => ({ ...s, [f]: v }));
    setProblem(null);
    setResent(false);
    if (f === "password") setServerPassword(undefined);
  };
  const blur = (f: FieldName) => () => setTouched((t) => ({ ...t, [f]: true }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true, password: true });
    if (Object.values(all).some(Boolean)) {
      setProblem(null);
      setFocusTick((n) => n + 1);
      return;
    }
    setPending(true);
    setProblem(null);
    setGoogleMessage(null);
    setResent(false);
    const email = values.email.trim();
    try {
      if (mode === "sign-in") {
        await signInWithEmail({ email, password: values.password });
        await refresh();
        void navigate(next, { replace: true });
      } else {
        await signUpWithEmail({ name: values.name.trim(), email, password: values.password, callbackURL: `/verify-email?next=${encodeURIComponent(next)}` });
        void navigate(`/check-email?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`);
      }
    } catch (error) {
      if (mode === "sign-up" && errorCode(error) === "PASSWORD_TOO_SHORT") {
        setServerPassword(`Enter a password of at least ${MIN_PASSWORD} characters.`);
        setFocusTick((n) => n + 1);
      } else {
        setProblem(problemOf(error, mode));
      }
      setPending(false);
    }
  }

  async function resend() {
    setPending(true);
    try {
      await sendVerificationEmail({ email: values.email.trim(), callbackURL: `/verify-email?next=${encodeURIComponent(next)}` });
      setProblem(null);
      setResent(true);
    } catch (error) {
      setProblem(problemOf(error, "sign-up"));
    }
    setPending(false);
  }

  const text = TEXT[mode];
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight">{text.title}</h1>
        <p className="text-fg-2">{text.subtitle}</p>
      </div>
      <GoogleButton next={next} onStart={() => setGoogleMessage(null)} onFailed={() => setGoogleMessage(GOOGLE_FAILED_MESSAGE)} />
      {googleMessage && (
        <p role="alert" className="text-sm text-danger">
          {googleMessage}
        </p>
      )}
      <div className="flex items-center gap-3 text-sm text-fg-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
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
              <Link to={`/forgot-password${nextQuery}`} className="rounded-sm text-sm font-semibold text-accent hover:underline">
                Forgot password?
              </Link>
            ) : undefined
          }
          rule={mode === "sign-up" ? { text: `At least ${MIN_PASSWORD} characters`, met: values.password.length >= MIN_PASSWORD } : undefined}
        />
        <Button type="submit" busy={pending}>
          {text.submit}
        </Button>
        {problem && (
          <div role="alert" className="flex flex-col items-start gap-1 text-sm text-danger">
            <p>{PROBLEM_TEXT[problem]}</p>
            {problem === "unverified" && (
              <Button variant="ghost" onClick={resend} disabled={pending}>
                Send the link again
              </Button>
            )}
          </div>
        )}
        <p role="status" className="text-sm text-fg-2">
          {resent ? "We sent the link again. Check your inbox." : ""}
        </p>
      </form>
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
        <Link to={`${mode === "sign-in" ? "/sign-up" : "/sign-in"}${nextQuery}`} className="font-semibold text-accent hover:underline">
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </Link>
      </p>
    </>
  );
}
