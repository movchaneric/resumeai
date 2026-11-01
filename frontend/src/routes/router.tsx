import { createBrowserRouter, createMemoryRouter, type RouteObject } from "react-router";
import { ErrorScreen } from "@/features/run/screens";
import { AppShell } from "@/routes/AppShell";
import { CheckEmailRoute, ForgotPasswordRoute, ResetPasswordRoute, SignInRoute, SignUpRoute, VerifyEmailRoute } from "@/routes/AuthRoutes";
import { MyRunsRoute } from "@/routes/MyRunsRoute";
import { NotFoundRoute } from "@/routes/NotFoundRoute";
import { RunRoute } from "@/routes/RunRoute";
import { UploadRoute } from "@/routes/UploadRoute";

export const appRoutes: RouteObject[] = [
  // The auth pages are full two-half layouts with their own brand header, so they sit outside AppShell.
  { path: "sign-in", element: <SignInRoute />, errorElement: <ErrorScreen /> },
  { path: "sign-up", element: <SignUpRoute />, errorElement: <ErrorScreen /> },
  { path: "check-email", element: <CheckEmailRoute />, errorElement: <ErrorScreen /> },
  { path: "verify-email", element: <VerifyEmailRoute />, errorElement: <ErrorScreen /> },
  { path: "forgot-password", element: <ForgotPasswordRoute />, errorElement: <ErrorScreen /> },
  { path: "reset-password", element: <ResetPasswordRoute />, errorElement: <ErrorScreen /> },
  {
    element: <AppShell />,
    errorElement: <ErrorScreen />,
    children: [
      { index: true, element: <UploadRoute /> },
      { path: "runs", element: <MyRunsRoute /> },
      { path: "runs/:id", element: <RunRoute /> },
      { path: "*", element: <NotFoundRoute /> },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(appRoutes);
export const createTestRouter = (entries: string[]) => createMemoryRouter(appRoutes, { initialEntries: entries });
