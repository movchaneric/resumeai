import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { Account, MyRuns } from "@resume-ai/shared";
import { server } from "./server";

export const ADA: Account = { accountId: "acc-1", name: "Ada Example", email: "ada@example.com", image: null };

/** `GET /api/account` answers with `account` (a signed-in person), or 401 for `null` (a guest). */
export function serveAccount(account: Account | null) {
  server.use(
    http.get("/api/account", () =>
      account ? HttpResponse.json(account) : HttpResponse.json({ code: "UNAUTHENTICATED", message: "Sign in." }, { status: 401 }),
    ),
  );
}

/** `GET /api/runs` answers with `runs`, newest first as the API sorts them. */
export function serveMyRuns(runs: MyRuns["runs"]) {
  server.use(http.get("/api/runs", () => HttpResponse.json({ runs })));
}

/** Answers one Better Auth endpoint with `status` and `body`, and records the JSON bodies it receives. */
export function serveAuth(path: string, status = 200, body: unknown = { status: true }) {
  const calls: unknown[] = [];
  server.use(
    http.post(`/api/auth${path}`, async ({ request }) => {
      calls.push(await request.json());
      return HttpResponse.json(body as Record<string, unknown>, { status });
    }),
  );
  return calls;
}

/** The app header. The Upload screen has its own `<header>`, so take the first banner. */
export const appHeader = () => screen.getAllByRole("banner")[0]!;
