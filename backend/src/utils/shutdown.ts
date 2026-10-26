import type { Server } from "node:http";
import type { OpenStreams } from "@/utils/openStreams.js";

/**
 * Stops the server accepting connections and ends the open Run event streams at once; `server.close` alone would wait
 * for them, and a stream only ends when the Run rests. Idle keep-alive connections are closed, but a request still in
 * flight finishes normally. Resolves when the server has closed.
 */
export function closeServer(server: Server, streams: OpenStreams): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
    // An ended stream's connection is idle only once the response is flushed, so close idle connections again after.
    void streams.endAll().then(() => server.closeIdleConnections());
  });
}
