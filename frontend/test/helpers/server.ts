import { setupServer } from "msw/node";

/** The MSW server shared by every test. Tests add handlers with `server.use(...)`; unhandled requests fail. */
export const server = setupServer();
