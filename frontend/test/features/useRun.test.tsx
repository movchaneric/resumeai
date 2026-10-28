import { act, screen } from "@testing-library/react";
import { http, HttpResponse, sse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunView } from "@resume-ai/shared";
import { POLL_MS } from "@/features/run/useRun";
import { RUN_ID, runView } from "../fixtures/runViews";
import { renderApp } from "../helpers/render";
import { server } from "../helpers/server";

const PATH = `/runs/${RUN_ID}`;
const EVENTS = `/api/runs/${RUN_ID}/events`;

/** A promise the test resolves to let the fake server go on to its next step. */
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

/** The server ends the stream. A short `retry` makes the test EventSource report that at once, as a browser does. */
const endStream: Parameters<typeof sse>[1] = ({ client }) => {
  client.send({ retry: 10 });
  client.close();
};

afterEach(() => {
  vi.useRealTimers();
});

describe("useRun: live updates", () => {
  it("writes each streamed view into the screen, one after the other", async () => {
    const sawParsing = gate();
    const reachedTailoring = gate();
    server.use(
      http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json(runView("parsing"))),
      sse<{ run: unknown }>(EVENTS, ({ client }) => {
        // Hold each view until the test has seen the one before (a fast fake would run past it). The resolver itself must
        // return at once: MSW sends the response only after it does.
        void sawParsing.promise
          .then(() => client.send({ event: "run", data: runView("tailoring") }))
          .then(() => reachedTailoring.promise)
          .then(() => client.send({ event: "run", data: runView("awaiting_review") }));
      }),
    );
    renderApp(PATH);

    expect(await screen.findByRole("heading", { name: "Reading your CV…" })).toBeInTheDocument();
    sawParsing.open();
    expect(await screen.findByRole("heading", { name: "Tailoring your CV" })).toBeInTheDocument();
    expect(screen.getByText("Round 2 of 3")).toBeInTheDocument();

    reachedTailoring.open();
    expect(await screen.findByRole("heading", { name: "Review your Changes" })).toBeInTheDocument();
    expect(screen.getByText("54 → 72")).toBeInTheDocument();
  });

  it("does not open a stream for a Run that is not working", async () => {
    let opened = 0;
    server.use(
      http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json(runView("awaiting_review"))),
      sse<{ run: unknown }>(EVENTS, () => {
        opened += 1;
      }),
    );
    renderApp(PATH);
    await screen.findByRole("heading", { name: "Review your Changes" });
    expect(opened).toBe(0);
  });

  it("ignores a streamed view that does not match the schema and falls back to a refetch", async () => {
    let gets = 0;
    server.use(
      http.get(`/api/runs/${RUN_ID}`, () => {
        gets += 1;
        return HttpResponse.json(gets === 1 ? runView("parsing") : runView("tailoring"));
      }),
      sse<{ run: unknown }>(EVENTS, ({ client }) => {
        client.send({ event: "run", data: { id: RUN_ID, status: "teleporting" } });
      }),
    );
    renderApp(PATH);
    expect(await screen.findByRole("heading", { name: "Tailoring your CV" })).toBeInTheDocument();
    expect(gets).toBe(2);
  });
});

describe("useRun: polling fallback", () => {
  it("polls every 3s after the stream breaks, until the Run settles", async () => {
    // Only the polling interval is faked; MSW and the rest run on real time.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const views: RunView[] = [runView("parsing"), runView("tailoring"), runView("awaiting_review")];
    let gets = 0;
    server.use(
      http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json(views[Math.min(gets++, views.length - 1)])),
      sse(EVENTS, endStream),
    );
    renderApp(PATH);

    // First load, then the stream fails and the Run is refetched at once.
    expect(await screen.findByRole("heading", { name: "Tailoring your CV" })).toBeInTheDocument();
    expect(gets).toBe(2);

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS - 500));
    expect(gets).toBe(2); // not yet

    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(await screen.findByRole("heading", { name: "Review your Changes" })).toBeInTheDocument();
    expect(gets).toBe(3);

    // The Run is now waiting for the user: polling stops.
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 2));
    expect(gets).toBe(3);
  });

  it("says 'Lost connection. Retrying…' after 3 failures in a row, and clears it once a view arrives", async () => {
    // Only the polling interval is faked; MSW and the rest run on real time.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    let gets = 0;
    let recovered = false;
    server.use(
      http.get(`/api/runs/${RUN_ID}`, () => {
        gets += 1;
        if (gets === 1) return HttpResponse.json(runView("parsing"));
        if (!recovered) return HttpResponse.json({ code: "INTERNAL", message: "Something went wrong." }, { status: 503 });
        return HttpResponse.json(runView("tailoring"));
      }),
      sse(EVENTS, endStream),
    );
    renderApp(PATH);

    expect(await screen.findByRole("heading", { name: "Reading your CV…" })).toBeInTheDocument();
    // Failure 1 is the stream, failure 2 the refetch that follows it; the screen stays up on the view it has.
    expect(screen.getByRole("status")).not.toHaveTextContent("Lost connection");

    // Failure 3 is the first poll.
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 100));
    expect(await screen.findByText("Lost connection. Retrying…", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Reading your CV…" })).toBeInTheDocument();

    recovered = true;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 100));
    expect(await screen.findByRole("heading", { name: "Tailoring your CV" })).toBeInTheDocument();
    expect(screen.queryByText("Lost connection. Retrying…")).toBeNull();
  });
});
