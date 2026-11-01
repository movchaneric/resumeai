import {
  RunErrorCodeSchema,
  RunStatusSchema,
  type RunErrorCode,
  type RunId,
  type RunStatus,
} from "@resume-ai/shared";
import type { PrismaClient, Run } from "@/generated/prisma/client.js";

/** Run metadata. The Run's data lives in the graph checkpoint (ADR 0003). */
export type StoredRun = {
  id: RunId;
  status: RunStatus;
  createdAt: Date;
  expiresAt: Date;
  /** The Account that owns the Run, or `null` for a Guest Run. */
  accountId: string | null;
  error: { code: RunErrorCode; message: string } | null;
};

/** `accountId` is left out for a Guest Run. */
export type NewRun = Pick<StoredRun, "id" | "status" | "createdAt" | "expiresAt"> & { accountId?: string | null; claimTokenHash?: string | null };

/** The one place a database row becomes a `StoredRun`: nothing unvalidated leaves the store. */
function toStoredRun(row: Run): StoredRun {
  return {
    id: row.id as RunId,
    status: RunStatusSchema.parse(row.status),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    accountId: row.accountId,
    error:
      row.errorCode === null
        ? null
        : { code: RunErrorCodeSchema.parse(row.errorCode), message: row.errorMessage ?? "" },
  };
}

/** Run metadata in Postgres. Nothing outside this module knows it is Prisma. */
export class RunStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(run: NewRun): Promise<StoredRun> {
    return toStoredRun(await this.prisma.run.create({ data: { ...run, accountId: run.accountId ?? null, claimTokenHash: run.claimTokenHash ?? null } }));
  }

  async get(id: RunId): Promise<StoredRun | null> {
    const row = await this.prisma.run.findUnique({ where: { id } });
    return row ? toStoredRun(row) : null;
  }

  /** The graph runner writes the status at node boundaries through this. */
  async setStatus(id: RunId, status: RunStatus): Promise<void> {
    await this.prisma.run.updateMany({ where: { id }, data: { status } });
  }

  /**
   * Moves the Run from `from` to `to` only if it is still in `from`, in one statement, and says whether it did.
   * It is the lock that lets just one of two simultaneous requests act on the same Run.
   */
  async claimStatus(id: RunId, from: RunStatus, to: RunStatus): Promise<boolean> {
    const { count } = await this.prisma.run.updateMany({ where: { id, status: from }, data: { status: to } });
    return count === 1;
  }

  /** The Runs created before `createdBefore` that have not expired at `now` and are in one of `statuses`, oldest first. */
  async listLive(statuses: RunStatus[], now: Date, createdBefore: Date): Promise<StoredRun[]> {
    const rows = await this.prisma.run.findMany({
      where: { status: { in: statuses }, expiresAt: { gt: now }, createdAt: { lt: createdBefore } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toStoredRun);
  }

  /**
   * Counts a recovery for the Run only if it is still in `status` and has never been recovered, in one statement, and
   * says whether it did. It is what limits a Run to one recovery.
   */
  async claimRecovery(id: RunId, status: RunStatus): Promise<boolean> {
    const { count } = await this.prisma.run.updateMany({ where: { id, status, recoveries: 0 }, data: { recoveries: { increment: 1 } } });
    return count === 1;
  }

  async markFailed(id: RunId, code: RunErrorCode, message: string): Promise<void> {
    await this.prisma.run.updateMany({ where: { id }, data: { status: "failed", errorCode: code, errorMessage: message } });
  }

  /**
   * Deletes the Run only if its status is not in `busy`, it has not expired at `liveAt` and `viewer` may delete it (a
   * Guest Run, or one owned by `viewer`), in one statement, and says whether it did. Like `claimStatus`, the condition
   * and the delete cannot be split by a simultaneous request, so the owner check cannot race the delete. It is what
   * `DELETE /runs/:id` uses.
   */
  async deleteIdleLive(id: RunId, busy: RunStatus[], liveAt: Date, viewer: string | null): Promise<boolean> {
    const { count } = await this.prisma.run.deleteMany({
      where: { id, status: { notIn: busy }, expiresAt: { gt: liveAt }, OR: viewer === null ? [{ accountId: null }] : [{ accountId: null }, { accountId: viewer }] },
    });
    return count === 1;
  }

  /**
   * Deletes the Account's Run only if it is idle (not in `busy`) or has expired at `now`, in one statement, and says
   * whether it did. It is what deleting an Account uses, so an expired Run that is still listed goes too.
   */
  async deleteOwnedIdle(id: RunId, accountId: string, busy: RunStatus[], now: Date): Promise<boolean> {
    const { count } = await this.prisma.run.deleteMany({ where: { id, accountId, OR: [{ status: { notIn: busy } }, { expiresAt: { lte: now } }] } });
    return count === 1;
  }

  /**
   * Hands the Guest Runs in `claims` that have not expired at `now` to the Account, in one statement, and moves their
   * expiry to created + `ownedTtlMs`. A Run is claimed only when its stored claim token hash equals the one given, and
   * the hash is cleared, so a token works once. An Owned, expired or missing Run, or a wrong token, is left alone.
   * Returns the IDs it claimed.
   */
  async claimGuestRuns(claims: { id: RunId; claimTokenHash: string }[], accountId: string, ownedTtlMs: number, now: Date): Promise<RunId[]> {
    if (claims.length === 0) return [];
    const ids = claims.map((claim) => claim.id);
    const hashes = claims.map((claim) => claim.claimTokenHash);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE app.runs
      SET account_id = ${accountId}, expires_at = created_at + (${ownedTtlMs}::double precision * interval '1 millisecond'), claim_token_hash = NULL
      WHERE account_id IS NULL AND expires_at > ${now}
        AND (id, claim_token_hash) IN (SELECT * FROM unnest(${ids}::uuid[], ${hashes}::text[]))
      RETURNING id`;
    return rows.map((row) => row.id as RunId);
  }

  /** The Account's Runs that have not expired at `now`, newest first. */
  async listOwned(accountId: string, now: Date): Promise<StoredRun[]> {
    const rows = await this.prisma.run.findMany({ where: { accountId, expiresAt: { gt: now } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
    return rows.map(toStoredRun);
  }

  /** Every Run of the Account, expired ones included: what deleting the Account must remove. */
  async listAllOwned(accountId: string): Promise<StoredRun[]> {
    const rows = await this.prisma.run.findMany({ where: { accountId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    return rows.map(toStoredRun);
  }

  /**
   * Deletes the Run only if it is still in `status` (the one the sweep listed) and has expired at `now`, in one
   * statement, and says whether it did. A Run that moved on since the listing is left alone.
   */
  async deleteExpiredIn(id: RunId, status: RunStatus, now: Date): Promise<boolean> {
    const { count } = await this.prisma.run.deleteMany({ where: { id, status, expiresAt: { lte: now } } });
    return count === 1;
  }

  /** The id and status of each Run that has expired at `now`, oldest first. */
  async listExpired(now: Date): Promise<{ id: RunId; status: RunStatus }[]> {
    const rows = await this.prisma.run.findMany({
      where: { expiresAt: { lte: now } },
      select: { id: true, status: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => ({ id: row.id as RunId, status: RunStatusSchema.parse(row.status) }));
  }

  async delete(id: RunId): Promise<void> {
    await this.prisma.run.deleteMany({ where: { id } });
  }

  /** Used by the integration tests to check that a rejected upload stored nothing. */
  async count(): Promise<number> {
    return this.prisma.run.count();
  }

  /** Used by the integration tests to start each case from an empty table. */
  async deleteAll(): Promise<void> {
    await this.prisma.run.deleteMany();
  }
}
