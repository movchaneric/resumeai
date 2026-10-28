import { createBrowserRouter, createMemoryRouter, type RouteObject } from "react-router";
import { ErrorScreen } from "@/features/run/screens";
import { AppShell } from "@/routes/AppShell";
import { SignInRoute, SignUpRoute } from "@/routes/AuthRoutes";
import { NotFoundRoute } from "@/routes/NotFoundRoute";
import { RunRoute } from "@/routes/RunRoute";
import { UploadRoute } from "@/routes/UploadRoute";

export const appRoutes: RouteObject[] = [
  {
    element: <AppShell />,
    errorElement: <ErrorScreen />,
    children: [
      { index: true, element: <UploadRoute /> },
      { path: "runs/:id", element: <RunRoute /> },
      { path: "sign-in", element: <SignInRoute /> },
      { path: "sign-up", element: <SignUpRoute /> },
      { path: "*", element: <NotFoundRoute /> },
    ],
  },
];

export const createAppRouter = () => createBrowserRouter(appRoutes);
export const createTestRouter = (entries: string[]) => createMemoryRouter(appRoutes, { initialEntries: entries });
