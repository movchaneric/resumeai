import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_CLAIM_IDS } from "@resume-ai/shared";
import { addGuestRun, myRunsKey, readGuestRuns, useAccount, useClaimGuestRuns, useMyRuns } from "@/features/account";
import { server } from "../../helpers/server";

const ADA = { accountId: "u1", name: "Ada Example", email: "ada@example.com", image: null };

function Probe() {
  useClaimGuestRuns();
  return null;
}

function renderClaim(strict = false) {
  const client = new QueryClient();
  const tree = (
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return client;
}

function serveAccount(account: typeof ADA | null) {
  server.use(
    http.get("/api/account", () => (account ? HttpResponse.json(account) : HttpResponse.json({ code: "UNAUTHENTICATED", message: "Sign in." }, { status: 401 }))),
  );
}

/** Answers claim posts: records the batches and claims every id except `invalid`. */
function serveClaim(opts: { invalid?: string[]; status?: number } = {}) {
  const batches: { id: string; claimToken: string }[][] = [];
  server.use(
    http.post("/api/runs/claim", async ({ request }) => {
      const { runs } = (await request.json()) as { runs: { id: string; claimToken: string }[] };
      batches.push(runs);
      if (opts.status) return HttpResponse.json({ code: "INTERNAL", message: "x" }, { status: opts.status });
      return HttpResponse.json({ claimed: runs.map((r) => r.id).filter((id) => !(opts.invalid ?? []).includes(id)) });
    }),
  );
  return batches;
}

const RUN_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const RUN_B = "1f8fad5b-d9cb-469f-a165-70867728950e";

beforeEach(() => window.localStorage.clear());

describe("claiming Guest Runs", () => {
  it("claims once for a signed-in Account (StrictMode too), clears the sent entries and refreshes My Runs", async () => {
    addGuestRun({ id: RUN_A, claimToken: "ta" });
    addGuestRun({ id: RUN_B, claimToken: "tb" });
    serveAccount(ADA);
    const batches = serveClaim({ invalid: [RUN_B] }); // a token the server rejects is dropped too
    const client = renderClaim(true);
    client.setQueryData(myRunsKey, { runs: [] });
    await waitFor(() => expect(readGuestRuns()).toEqual([]));
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((r) => r.id).sort()).toEqual([RUN_A, RUN_B].sort());
    await waitFor(() => expect(client.getQueryState(myRunsKey)?.isInvalidated).toBe(true));
  });

  it("does nothing for a guest, and keeps the stored Runs", async () => {
    addGuestRun({ id: RUN_A, claimToken: "ta" });
    serveAccount(null);
    const batches = serveClaim();
    const client = renderClaim();
    await waitFor(() => expect(client.getQueryData(["account"])).toBeNull());
    await new Promise((r) => setTimeout(r, 30));
    expect(batches).toHaveLength(0);
    expect(readGuestRuns()).toHaveLength(1);
  });

  it("does not call the server when nothing is stored", async () => {
    serveAccount(ADA);
    const batches = serveClaim();
    const client = renderClaim();
    await waitFor(() => expect(client.getQueryData(["account"])).toEqual(ADA));
    await new Promise((r) => setTimeout(r, 30));
    expect(batches).toHaveLength(0);
  });

  it("keeps the entries when the claim fails with a 5xx", async () => {
    addGuestRun({ id: RUN_A, claimToken: "ta" });
    serveAccount(ADA);
    const batches = serveClaim({ status: 503 });
    renderClaim();
    await waitFor(() => expect(batches).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(readGuestRuns()).toHaveLength(1);
  });

  it("keeps the entries when the network is down", async () => {
    addGuestRun({ id: RUN_A, claimToken: "ta" });
    serveAccount(ADA);
    let calls = 0;
    server.use(http.post("/api/runs/claim", () => (calls++, HttpResponse.error())));
    renderClaim();
    await waitFor(() => expect(calls).toBe(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(readGuestRuns()).toHaveLength(1);
  });

  it("sends at most MAX_CLAIM_IDS per request", async () => {
    // The store keeps MAX_CLAIM_IDS, so write more directly to see the chunking.
    const many = Array.from({ length: MAX_CLAIM_IDS + 3 }, (_, i) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, claimToken: "t", createdAt: Date.now() - i }));
    window.localStorage.setItem("resume-ai.guestRuns", JSON.stringify(many));
    serveAccount(ADA);
    const batches = serveClaim();
    renderClaim();
    await waitFor(() => expect(readGuestRuns()).toEqual([]));
    expect(batches.map((b) => b.length).reduce((a, b) => a + b, 0)).toBe(MAX_CLAIM_IDS);
    expect(batches.every((b) => b.length <= MAX_CLAIM_IDS)).toBe(true);
  });
});

describe("account and My Runs hooks", () => {
  function Show() {
    const { account, isPending } = useAccount();
    const runs = useMyRuns({ enabled: !!account });
    return <p>{isPending ? "pending" : account ? `${account.name}:${runs.data?.runs.length ?? "-"}` : "guest"}</p>;
  }

  it("useAccount treats 401 as a guest, not an error", async () => {
    serveAccount(null);
    const client = new QueryClient();
    const { findByText } = render(
      <QueryClientProvider client={client}>
        <Show />
      </QueryClientProvider>,
    );
    expect(await findByText("guest")).toBeInTheDocument();
    expect(client.getQueryState(["account"])?.status).toBe("success");
  });

  it("useMyRuns loads My Runs for a signed-in Account", async () => {
    serveAccount(ADA);
    server.use(http.get("/api/runs", () => HttpResponse.json({ runs: [] })));
    const { findByText } = render(
      <QueryClientProvider client={new QueryClient()}>
        <Show />
      </QueryClientProvider>,
    );
    expect(await findByText("Ada Example:0")).toBeInTheDocument();
  });
});
