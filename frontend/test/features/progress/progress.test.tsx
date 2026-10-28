import { act, screen, within } from "@testing-library/react";
import { http, HttpResponse, sse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RUN_ID, TAILORING_STEPS, runView, stepsOf } from "../../fixtures/runViews";
import { expectNoSeriousViolations } from "../../helpers/axe";
import { renderApp, serveIdleStream, serveRun } from "../../helpers/render";
import { server } from "../../helpers/server";

const PATH = `/runs/${RUN_ID}`;
const EVENTS = `/api/runs/${RUN_ID}/events`;

afterEach(() => vi.unstubAllGlobals());

function row(name: string) {
  return screen.getByText(name).closest("li") as HTMLElement;
}

/** A stream the test pushes views into, one at a time. */
function controlledStream() {
  let send: (view: unknown) => void = () => {};
  const ready = new Promise<void>((resolve) => {
    server.use(
      sse<{ run: unknown }>(EVENTS, ({ client }) => {
        send = (view) => client.send({ event: "run", data: view });
        resolve();
      }),
    );
  });
  return { ready, push: (view: unknown) => send(view) };
}

describe("progress screen", () => {
  it("groups parse and extract into one row and marks done, running and pending steps", async () => {
    serveRun(RUN_ID, runView("tailoring", { steps: TAILORING_STEPS }));
    serveIdleStream(RUN_ID);
    const { container } = renderApp(PATH);

    expect(await screen.findByRole("heading", { level: 1, name: "Tailoring your CV" })).toBeInTheDocument();
    expect(screen.getByText(/the link above brings you back to it for 7 days/)).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(within(row("Read your CV and the job")).getByText("Done")).toBeInTheDocument();
    expect(within(row("Tailoring")).getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Round 1 of 3")).toBeInTheDocument();
    expect(within(row("Tailoring")).getByText(/Rewording bullets toward the Requirements/)).toBeInTheDocument();
    expect(within(row("Fit it on one page")).getByText("Not started")).toBeInTheDocument();
    expect(within(row("Fit it on one page")).queryByText(/Rewording shorter/)).toBeNull();
    expect(screen.getByText("—")).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });

  it("explains the fit step when it runs", async () => {
    serveRun(
      RUN_ID,
      runView("tailoring", { steps: stepsOf(["parse", "done"], ["extract", "done"], ["tailor", "done"], ["fit", "running"], ["review", "pending"]) }),
    );
    serveIdleStream(RUN_ID);
    renderApp(PATH);
    await screen.findByRole("heading", { name: "Tailoring your CV" });
    expect(within(row("Fit it on one page")).getByText(/Rewording shorter, then removing the least relevant bullets/)).toBeInTheDocument();
  });

  it("shows only the steps the view has", async () => {
    serveRun(RUN_ID, runView("parsing", { steps: stepsOf(["parse", "running"]) }));
    serveIdleStream(RUN_ID);
    const { container } = renderApp(PATH);
    expect(await screen.findByRole("heading", { name: "Reading your CV…" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Reading your CV.");
    await expectNoSeriousViolations(container);
  });

  it("shows the delta chip once the score after arrives", async () => {
    serveRun(RUN_ID, runView("tailoring", { steps: TAILORING_STEPS, score: { before: 54, after: 70 } }));
    serveIdleStream(RUN_ID);
    renderApp(PATH);
    expect(await screen.findByText("+16")).toBeInTheDocument();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("shows 'Lost connection. Retrying…' in the status region", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    server.use(
      http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json(runView("tailoring", { steps: TAILORING_STEPS }))),
      http.get(EVENTS, () => HttpResponse.error()),
    );
    renderApp(PATH);
    await screen.findByRole("heading", { name: "Tailoring your CV" });
    server.use(http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.error()));
    await act(() => vi.advanceTimersByTimeAsync(15000));
    vi.useRealTimers();
    expect(await screen.findByText("Lost connection. Retrying…")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  describe("announcements", () => {
    it("announces a step change through the single status region", async () => {
      const stream = controlledStream();
      serveRun(RUN_ID, runView("extracting", { steps: stepsOf(["parse", "done"], ["extract", "running"]) }));
      renderApp(PATH);
      await screen.findByRole("heading", { name: "Tailoring your CV" });
      expect(screen.getByRole("status")).toHaveTextContent("Reading the Job Description.");
      await stream.ready;

      act(() => stream.push(runView("tailoring", { steps: TAILORING_STEPS })));
      await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Tailoring, round 1 of 3."));
      expect(screen.getAllByRole("status")).toHaveLength(1);
    });

    it("shows Round 1 of 3 while the first round runs (used: 1)", async () => {
      serveRun(RUN_ID, runView("tailoring", { steps: TAILORING_STEPS, iterations: { used: 1, max: 3 } }));
      renderApp(PATH);
      expect(await screen.findByText("Round 1 of 3")).toBeInTheDocument();
    });

    it("announces the score when a round ends, not on every update", async () => {
      const stream = controlledStream();
      serveRun(RUN_ID, runView("tailoring", { steps: TAILORING_STEPS, iterations: { used: 1, max: 3 } }));
      renderApp(PATH);
      await screen.findByRole("heading", { name: "Tailoring your CV" });
      expect(screen.getByRole("status")).toHaveTextContent("Tailoring, round 1 of 3.");
      await stream.ready;

      // The score moves inside the round: the region stays as it was.
      act(() => stream.push(runView("tailoring", { steps: TAILORING_STEPS, iterations: { used: 1, max: 3 }, score: { before: 54, after: 60 } })));
      await screen.findByText("+6");
      expect(screen.getByRole("status")).toHaveTextContent("Tailoring, round 1 of 3.");
      expect(screen.getByRole("status")).not.toHaveTextContent(/Match Score/);

      // Round 2 starts, so round 1 ended.
      act(() => stream.push(runView("tailoring", { steps: TAILORING_STEPS, iterations: { used: 2, max: 3 }, score: { before: 54, after: 66 } })));
      await vi.waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Round 1 finished. Match Score 54 to 66."));

      // A further update inside the next round does not replace it.
      act(() => stream.push(runView("tailoring", { steps: TAILORING_STEPS, iterations: { used: 2, max: 3 }, score: { before: 54, after: 68 } })));
      await screen.findByText("+14");
      expect(screen.getByRole("status")).toHaveTextContent("Round 1 finished. Match Score 54 to 66.");
    });
  });

  describe("reduced motion", () => {
    const stubMotion = (reduce: boolean) =>
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));

    it("spins while the user allows motion", async () => {
      stubMotion(false);
      serveRun(RUN_ID, runView("tailoring", { steps: TAILORING_STEPS }));
      serveIdleStream(RUN_ID);
      renderApp(PATH);
      expect(await screen.findByTestId("spinner")).toBeInTheDocument();
      expect(screen.queryByTestId("static-icon")).toBeNull();
    });

    it("shows a static icon when the user asks for reduced motion", async () => {
      stubMotion(true);
      serveRun(RUN_ID, runView("tailoring", { steps: TAILORING_STEPS }));
      serveIdleStream(RUN_ID);
      renderApp(PATH);
      expect(await screen.findByTestId("static-icon")).toBeInTheDocument();
      expect(screen.queryByTestId("spinner")).toBeNull();
    });
  });
});

describe("failed screen", () => {
  it("marks the step that broke and shows the message for the error code", async () => {
    serveRun(
      RUN_ID,
      runView("failed", {
        steps: stepsOf(["parse", "done"], ["extract", "done"], ["coverage", "failed"], ["tailor", "pending"]),
        error: { code: "COVERAGE_FAILED", message: "internal detail" },
      }),
    );
    const { container } = renderApp(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "This Run didn't finish" })).toBeInTheDocument();
    expect(screen.getByText("We couldn't compare your CV with the job.")).toBeInTheDocument();
    expect(screen.getByText("Try again in a moment.")).toBeInTheDocument();
    expect(within(row("Checked the Requirements")).getByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new Run" })).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("status")).toHaveLength(1);
    await expectNoSeriousViolations(container);
  });

  it.each([
    ["EXTRACTION_FAILED", "We couldn't understand this CV or Job Description.", "Try again; if it keeps failing, try the other file format."],
    ["NO_REQUIREMENTS", "We found no Requirements in this Job Description.", "Paste the full posting, including its requirements."],
    ["INTERNAL", "Something broke on our side.", "Try again in a moment."],
  ])("%s", async (code, headline, hint) => {
    serveRun(RUN_ID, runView("failed", { error: { code, message: "x" } }));
    renderApp(PATH);
    expect(await screen.findByText(headline)).toBeInTheDocument();
    expect(screen.getByText(hint)).toBeInTheDocument();
  });
});

describe("interrupted screen", () => {
  it("says the Run was cut off and offers a new Run", async () => {
    serveRun(RUN_ID, runView("interrupted"));
    const { container } = renderApp(PATH);
    expect(await screen.findByRole("heading", { level: 1, name: "This Run was cut off" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("This Run was cut off by a server restart and can't continue.");
    expect(screen.getByText("Start a new Run with the same files.")).toBeInTheDocument();
    await expectNoSeriousViolations(container);
  });
});
