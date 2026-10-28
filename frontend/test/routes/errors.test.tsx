import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { RUN_ID } from "../fixtures/runViews";
import { expectNoSeriousViolations } from "../helpers/axe";
import { renderApp } from "../helpers/render";
import { server } from "../helpers/server";

describe("error and missing pages", () => {
  it("a 404 Run shows the expired page", async () => {
    server.use(http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json({ code: "RUN_NOT_FOUND", message: "No such Run." }, { status: 404 })));
    const { container } = renderApp(`/runs/${RUN_ID}`);
    expect(await screen.findByRole("heading", { name: "This Run doesn't exist or has expired" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start a new Run" })).toHaveAttribute("href", "/");
    await expectNoSeriousViolations(container);
  });

  it("a malformed response shows the error screen, not a broken page", async () => {
    server.use(http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json({ id: RUN_ID, status: "teleporting" })));
    const { container } = renderApp(`/runs/${RUN_ID}`);
    expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("We couldn't read the server's answer.");
    await expectNoSeriousViolations(container);
  });

  it("a server error on the first load offers to try again", async () => {
    let calls = 0;
    server.use(
      http.get(`/api/runs/${RUN_ID}`, () => {
        calls += 1;
        return HttpResponse.json({ code: "INTERNAL", message: "Something went wrong." }, { status: 500 });
      }),
    );
    renderApp(`/runs/${RUN_ID}`);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("an unknown path shows the same not-found page", async () => {
    renderApp("/nowhere");
    expect(await screen.findByRole("heading", { name: "This Run doesn't exist or has expired" })).toBeInTheDocument();
  });
});
