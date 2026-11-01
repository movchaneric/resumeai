import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CLAIM_IDS } from "@resume-ai/shared";
import { GUEST_RUN_MAX_AGE_MS, addGuestRun, readGuestRuns, removeGuestRuns } from "@/features/account";

const NOW = 1_800_000_000_000;

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("guestRuns", () => {
  it("records a Guest Run only when it has a claim token", () => {
    addGuestRun({ id: "r1" }, NOW);
    expect(readGuestRuns(NOW)).toEqual([]);
    addGuestRun({ id: "r1", claimToken: "t1" }, NOW);
    expect(readGuestRuns(NOW)).toEqual([{ id: "r1", claimToken: "t1", createdAt: NOW }]);
  });

  it("reads newest first and replaces an entry with the same id", () => {
    addGuestRun({ id: "r1", claimToken: "t1" }, NOW);
    addGuestRun({ id: "r2", claimToken: "t2" }, NOW + 1000);
    addGuestRun({ id: "r1", claimToken: "t1b" }, NOW + 2000);
    expect(readGuestRuns(NOW + 2000).map((r) => [r.id, r.claimToken])).toEqual([["r1", "t1b"], ["r2", "t2"]]);
  });

  it("drops entries older than 7 days", () => {
    addGuestRun({ id: "old", claimToken: "t" }, NOW);
    addGuestRun({ id: "new", claimToken: "t" }, NOW + GUEST_RUN_MAX_AGE_MS);
    expect(readGuestRuns(NOW + GUEST_RUN_MAX_AGE_MS + 1).map((r) => r.id)).toEqual(["new"]);
  });

  it("keeps at most MAX_CLAIM_IDS, the newest", () => {
    for (let i = 0; i < MAX_CLAIM_IDS + 5; i++) addGuestRun({ id: `r${i}`, claimToken: "t" }, NOW + i);
    const runs = readGuestRuns(NOW + 1000);
    expect(runs).toHaveLength(MAX_CLAIM_IDS);
    expect(runs[0]!.id).toBe(`r${MAX_CLAIM_IDS + 4}`);
    expect(runs.some((r) => r.id === "r0")).toBe(false);
  });

  it("removes ids", () => {
    addGuestRun({ id: "r1", claimToken: "t" }, NOW);
    addGuestRun({ id: "r2", claimToken: "t" }, NOW);
    removeGuestRuns(["r1"], NOW);
    expect(readGuestRuns(NOW).map((r) => r.id)).toEqual(["r2"]);
    removeGuestRuns(["r2"], NOW);
    expect(window.localStorage.length).toBe(0);
  });

  it("ignores malformed stored data", () => {
    window.localStorage.setItem("resume-ai.guestRuns", "{not json");
    expect(readGuestRuns(NOW)).toEqual([]);
    window.localStorage.setItem("resume-ai.guestRuns", JSON.stringify([{ id: 1 }, null, "x", { id: "ok", claimToken: "t", createdAt: NOW }]));
    expect(readGuestRuns(NOW).map((r) => r.id)).toEqual(["ok"]);
    window.localStorage.setItem("resume-ai.guestRuns", JSON.stringify({ not: "an array" }));
    expect(readGuestRuns(NOW)).toEqual([]);
  });

  it("never throws when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => addGuestRun({ id: "r1", claimToken: "t" }, NOW)).not.toThrow();
    expect(readGuestRuns(NOW)).toEqual([]);
    expect(() => removeGuestRuns(["r1"], NOW)).not.toThrow();
  });
});
