import type { ReactNode } from "react";
import { Navigate, useSearchParams } from "react-router";
import { safeNext, useAccount } from "@/features/account";
import { AuthForm } from "@/features/auth/AuthForm";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { SignInPanel, SignUpPanel } from "@/features/auth/BrandPanels";
import { CheckEmail } from "@/features/auth/CheckEmail";
import { ForgotPassword } from "@/features/auth/ForgotPassword";
import { ResetPassword } from "@/features/auth/ResetPassword";
import { useTitle } from "@/features/auth/useTitle";
import { VerifyEmail } from "@/features/auth/VerifyEmail";

/** Someone who is already signed in has no use for the sign-in or sign-up page: send them on. */
function SkipWhenSignedIn({ children }: { children: ReactNode }) {
  const { account } = useAccount();
  const [params] = useSearchParams();
  if (account) return <Navigate to={safeNext(params.get("next"))} replace />;
  return children;
}

export function SignInRoute() {
  useTitle("Sign in");
  return (
    <SkipWhenSignedIn>
      <AuthLayout panel={<SignInPanel />}>
        <AuthForm mode="sign-in" />
      </AuthLayout>
    </SkipWhenSignedIn>
  );
}

export function SignUpRoute() {
  useTitle("Create your account");
  return (
    <SkipWhenSignedIn>
      <AuthLayout panel={<SignUpPanel />}>
        <AuthForm mode="sign-up" />
      </AuthLayout>
    </SkipWhenSignedIn>
  );
}

export const CheckEmailRoute = () => (
  <AuthLayout panel={<SignUpPanel />}>
    <CheckEmail />
  </AuthLayout>
);
export const VerifyEmailRoute = () => (
  <AuthLayout panel={<SignInPanel />}>
    <VerifyEmail />
  </AuthLayout>
);
export const ForgotPasswordRoute = () => (
  <AuthLayout panel={<SignInPanel />}>
    <ForgotPassword />
  </AuthLayout>
);
export const ResetPasswordRoute = () => (
  <AuthLayout panel={<SignInPanel />}>
    <ResetPassword />
  </AuthLayout>
);
