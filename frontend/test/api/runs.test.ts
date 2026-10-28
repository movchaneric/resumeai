import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { ApiError, answer, createRun, deleteRun, downloadUrl, getRun, previewReview, submitReview } from "@/api";
import { RUN_ID, runView } from "../fixtures/runViews";
import { server } from "../helpers/server";

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("api client", () => {
  it("getRun returns a view parsed with the shared schema", async () => {
    server.use(http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json(runView("awaiting_review"))));
    const run = await getRun(RUN_ID);
    expect(run.status).toBe("awaiting_review");
    if (run.status === "awaiting_review") expect(run.changes).toHaveLength(3);
  });

  it("maps an error body to a typed ApiError with its details", async () => {
    server.use(http.post(`/api/runs/${RUN_ID}/review`, () => HttpResponse.json({ code: "CV_TOO_LONG", message: "Too long.", overByLines: 4 }, { status: 409 })));
    const error = await failure(submitReview(RUN_ID, { decisions: [], drops: [] }));
    expect(error).toMatchObject({ status: 409, code: "CV_TOO_LONG", message: "Too long.", details: { overByLines: 4 } });
    expect(error.isNotFound).toBe(false);
  });

  it("flags a 404 as not found", async () => {
    server.use(http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json({ code: "RUN_NOT_FOUND", message: "No such Run." }, { status: 404 })));
    expect((await failure(getRun(RUN_ID))).isNotFound).toBe(true);
  });

  it("gives a body that is not an error shape a plain INTERNAL error with the status", async () => {
    server.use(http.get(`/api/runs/${RUN_ID}`, () => new HttpResponse("<html>Bad gateway</html>", { status: 502 })));
    expect(await failure(getRun(RUN_ID))).toMatchObject({ status: 502, code: "INTERNAL" });
  });

  it("treats a response that does not match the schema as a parse error of its own kind", async () => {
    server.use(http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.json({ id: RUN_ID, status: "teleporting" })));
    const error = await failure(getRun(RUN_ID));
    expect(error.isParseError).toBe(true);
    expect(error.isNotFound).toBe(false);
  });

  it("treats a body that is not JSON as a parse error", async () => {
    server.use(http.get(`/api/runs/${RUN_ID}`, () => new HttpResponse("nope", { status: 200 })));
    expect((await failure(getRun(RUN_ID))).isParseError).toBe(true);
  });

  it("reports an unreachable server as a network error with status 0", async () => {
    server.use(http.get(`/api/runs/${RUN_ID}`, () => HttpResponse.error()));
    const error = await failure(getRun(RUN_ID));
    expect(error).toMatchObject({ status: 0 });
    expect(error.isNetworkError).toBe(true);
  });

  it("createRun sends multipart with the cv and jobDescription and returns the ID", async () => {
    // jsdom's FormData can't be sent through the fetch under MSW, so this one test looks at what fetch is given.
    const fetchSpy = vi.fn(async () => Response.json({ id: RUN_ID }, { status: 201 }));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const id = await createRun({ cv: new File(["x"], "cv.pdf", { type: "application/pdf" }), jobDescription: "Backend role" });
      expect(id).toBe(RUN_ID);
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("/api/runs");
      expect(init.method).toBe("POST");
      const form = init.body as FormData;
      expect((form.get("cv") as File).name).toBe("cv.pdf");
      expect(form.get("jobDescription")).toBe("Backend role");
      expect(new Headers(init.headers).has("content-type")).toBe(false); // the browser sets the multipart boundary
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("answer and submitReview send JSON and return the ID", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`/api/runs/${RUN_ID}/answers`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ id: RUN_ID }, { status: 202 });
      }),
      http.post(`/api/runs/${RUN_ID}/review`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ id: RUN_ID }, { status: 202 });
      }),
    );
    expect(await answer(RUN_ID, [{ kind: "no_experience", questionId: "q1" as never }])).toBe(RUN_ID);
    expect(await submitReview(RUN_ID, { decisions: [], drops: [] })).toBe(RUN_ID);
    expect(bodies).toEqual([{ answers: [{ kind: "no_experience", questionId: "q1" }] }, { decisions: [], drops: [] }]);
  });

  it("previewReview parses the fit", async () => {
    server.use(http.post(`/api/runs/${RUN_ID}/review/preview`, () => HttpResponse.json({ fits: false, overByLines: 3, fittable: true })));
    expect(await previewReview(RUN_ID, { decisions: [], drops: [] })).toEqual({ fits: false, overByLines: 3, fittable: true });
  });

  it("deleteRun resolves on 204", async () => {
    server.use(http.delete(`/api/runs/${RUN_ID}`, () => new HttpResponse(null, { status: 204 })));
    await expect(deleteRun(RUN_ID)).resolves.toBeUndefined();
  });

  it("builds download URLs under the API base", () => {
    expect(downloadUrl(RUN_ID, "pdf")).toBe(`/api/runs/${RUN_ID}/cv.pdf`);
    expect(downloadUrl(RUN_ID, "docx")).toBe(`/api/runs/${RUN_ID}/cv.docx`);
  });
});
