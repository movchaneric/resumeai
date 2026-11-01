import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readGuestRuns } from "@/features/account";
import { RUN_ID } from "../../fixtures/runViews";
import { renderApp, serveIdleStream } from "../../helpers/render";
import { server } from "../../helpers/server";

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

async function upload(response: Response) {
  const user = userEvent.setup();
  const real = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit = {}) => (init.method === "POST" ? Promise.resolve(response) : real(url, init))));
  serveIdleStream(RUN_ID);
  server.use(http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json({ code: "RUN_NOT_FOUND", message: "x" }, { status: 404 })));
  const { router } = renderApp("/");
  await user.upload(await screen.findByLabelText(/Choose a file or drop it here/), new File([new Uint8Array(10)], "cv.pdf", { type: "application/pdf" }));
  await user.click(screen.getByLabelText("Job Description"));
  await user.paste("Backend role");
  await user.click(screen.getByRole("button", { name: "Tailor my CV →" }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/runs/${RUN_ID}`));
}

describe("Upload records the Guest Run", () => {
  it("stores the id and claim token of a Guest Run", async () => {
    await upload(Response.json({ id: RUN_ID, claimToken: "tok-1" }, { status: 201 }));
    expect(readGuestRuns()).toMatchObject([{ id: RUN_ID, claimToken: "tok-1" }]);
  });

  it("stores nothing for an Owned Run (no claim token)", async () => {
    await upload(Response.json({ id: RUN_ID }, { status: 201 }));
    expect(readGuestRuns()).toEqual([]);
  });
});
