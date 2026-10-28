import { AuthForm } from "@/features/auth/AuthForm";
import { AuthLayout } from "@/features/auth/AuthLayout";
import { SignInPanel, SignUpPanel } from "@/features/auth/BrandPanels";

export function SignInRoute() {
  return (
    <AuthLayout panel={<SignInPanel />}>
      <AuthForm mode="sign-in" />
    </AuthLayout>
  );
}

export function SignUpRoute() {
  return (
    <AuthLayout panel={<SignUpPanel />}>
      <AuthForm mode="sign-up" />
    </AuthLayout>
  );
}
