import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider } from "react-router";
import { http, HttpResponse, sse } from "msw";
import type { RunView } from "@resume-ai/shared";
import { createTestRouter } from "@/routes/router";
import { ToastProvider } from "@/ui/Toast";
import { server } from "./server";

export function renderApp(path: string) {
  const client = new QueryClient();
  const router = createTestRouter([path]);
  const utils = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, client };
}

/** `GET /api/runs/:id` answers with `view` (or, given a function, with whatever it returns each time). */
export function serveRun(id: string, view: RunView | (() => RunView)) {
  server.use(http.get(`/api/runs/${id}`, () => HttpResponse.json(typeof view === "function" ? view() : view)));
}

/** An events stream that stays open and sends nothing. */
export function serveIdleStream(id: string) {
  server.use(sse(`/api/runs/${id}/events`, () => {}));
}
