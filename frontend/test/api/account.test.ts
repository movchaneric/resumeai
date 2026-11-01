import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { ApiError, claimRuns, deleteAccount, getAccount, listRuns } from "@/api";
import { server } from "../helpers/server";

const ADA = { accountId: "u1", name: "Ada Example", email: "ada@example.com", image: null };
const RUN = "0f8fad5b-d9cb-469f-a165-70867728950e";

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("account api", () => {
  it("getAccount returns the Account, with its image", async () => {
    server.use(http.get("/api/account", () => HttpResponse.json({ ...ADA, image: "https://example.com/ada.png" })));
    expect(await getAccount()).toEqual({ ...ADA, image: "https://example.com/ada.png" });
  });

  it("getAccount answers null for 401 UNAUTHENTICATED", async () => {
    server.use(http.get("/api/account", () => HttpResponse.json({ code: "UNAUTHENTICATED", message: "Sign in." }, { status: 401 })));
    expect(await getAccount()).toBeNull();
  });

  it("getAccount fails with an ApiError for a 500, a network error and a bad shape", async () => {
    server.use(http.get("/api/account", () => HttpResponse.json({ code: "INTERNAL", message: "Boom." }, { status: 500 })));
    expect(await failure(getAccount())).toMatchObject({ status: 500, code: "INTERNAL" });
    server.use(http.get("/api/account", () => HttpResponse.error()));
    expect((await failure(getAccount())).isNetworkError).toBe(true);
    server.use(http.get("/api/account", () => HttpResponse.json({ accountId: "u1" })));
    expect((await failure(getAccount())).isParseError).toBe(true);
  });

  it("deleteAccount sends DELETE and accepts 204; 409 RUN_BUSY is an ApiError", async () => {
    let method = "";
    server.use(http.delete("/api/account", ({ request }) => ((method = request.method), new HttpResponse(null, { status: 204 }))));
    await deleteAccount();
    expect(method).toBe("DELETE");
    server.use(http.delete("/api/account", () => HttpResponse.json({ code: "RUN_BUSY", message: "A Run is working." }, { status: 409 })));
    expect(await failure(deleteAccount())).toMatchObject({ status: 409, code: "RUN_BUSY" });
  });

  it("listRuns parses My Runs; 401 is an ApiError", async () => {
    server.use(
      http.get("/api/runs", () =>
        HttpResponse.json({ runs: [{ id: RUN, status: "completed", createdAt: "2026-01-02T03:04:05.000Z", jobTitle: "Engineer", company: null, matchScore: 80 }] }),
      ),
    );
    expect((await listRuns()).runs[0]).toMatchObject({ id: RUN, jobTitle: "Engineer", company: null });
    server.use(http.get("/api/runs", () => HttpResponse.json({ code: "UNAUTHENTICATED", message: "Sign in." }, { status: 401 })));
    expect(await failure(listRuns())).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("claimRuns posts the runs and returns the claimed IDs", async () => {
    let body: unknown;
    server.use(http.post("/api/runs/claim", async ({ request }) => ((body = await request.json()), HttpResponse.json({ claimed: [RUN] }))));
    expect(await claimRuns([{ id: RUN, claimToken: "tok" }])).toEqual({ claimed: [RUN] });
    expect(body).toEqual({ runs: [{ id: RUN, claimToken: "tok" }] });
  });
});
