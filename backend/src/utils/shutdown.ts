import type { Server } from "node:http";

/**
 * Stops the server accepting connections and ends the open ones at once. `server.close` alone waits for every
 * connection to end, and a Run's event stream only ends when the Run rests, so a stop would hang. Resolves when closed.
 */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}
