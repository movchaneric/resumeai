import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

/** The default answer for `GET /api/account`: a guest. A test that needs an Account overrides it with `server.use(...)`. */
export const guestAccountHandler = http.get("/api/account", () => HttpResponse.json({ code: "UNAUTHENTICATED", message: "Sign in." }, { status: 401 }));

/** The MSW server shared by every test. Tests add handlers with `server.use(...)`; unhandled requests fail. */
export const server = setupServer(guestAccountHandler);
