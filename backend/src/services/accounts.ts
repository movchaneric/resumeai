import type { AccountsService } from "@/auth/accounts.js";
import type { RunsService } from "@/services/runs.js";

/** What deleting an Account takes from the other services, so this one is tested without a database. */
export type AccountDeletionDeps = {
  runs: Pick<RunsService, "deleteOwnedRuns">;
  accounts: Pick<AccountsService, "deleteAccount">;
};

/** The business rule for deleting an Account. It knows nothing about HTTP. */
export class AccountDeletionService {
  constructor(private readonly deps: AccountDeletionDeps) {}

  /**
   * Deletes the Account's Owned Runs with their checkpoints first (`RUN_BUSY` while one is working, and then nothing is
   * deleted), then the Account with its sessions and linked accounts. The order matters: the checkpoints have no
   * foreign key (ADR 0005), so only the Run delete path removes them, and the user row refuses to go while a Run points to it.
   */
  async deleteAccount(accountId: string): Promise<void> {
    await this.deps.runs.deleteOwnedRuns(accountId);
    await this.deps.accounts.deleteAccount(accountId);
  }
}
