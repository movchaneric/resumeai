import { describe, expect, it } from "vitest";
import { AccountDeletionService } from "@/services/accounts.js";
import { ApiError } from "@/utils/errors.js";

describe("AccountDeletionService", () => {
  it("deletes the Account's Runs before the Account", async () => {
    const calls: string[] = [];
    const service = new AccountDeletionService({
      runs: { deleteOwnedRuns: async (id) => void calls.push(`runs:${id}`) },
      accounts: { deleteAccount: async (id) => void calls.push(`account:${id}`) },
    });
    await service.deleteAccount("account-ada");
    expect(calls).toEqual(["runs:account-ada", "account:account-ada"]);
  });

  it("leaves the Account alone when a Run is busy", async () => {
    const calls: string[] = [];
    const busy = new ApiError("RUN_BUSY", "A Run is still working.");
    const service = new AccountDeletionService({
      runs: { deleteOwnedRuns: async () => Promise.reject(busy) },
      accounts: { deleteAccount: async (id) => void calls.push(id) },
    });
    await expect(service.deleteAccount("account-ada")).rejects.toBe(busy);
    expect(calls).toEqual([]);
  });
});
