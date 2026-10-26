import {
  RunErrorCodeSchema,
  RunViewSchema,
  type RunErrorCode,
  type RunId,
  type RunStatus,
} from "@resume-ai/shared";
import { z } from "zod";
import type { PrismaClient, Run } from "@/generated/prisma/client.js";

/** Run metadata. The Run's data lives in the graph checkpoint (ADR 0003). */
export type StoredRun = {
  id: RunId;
  status: RunStatus;
  createdAt: Date;
  expiresAt: Date;
  exportPath: string | null;
  error: { code: RunErrorCode; message: string } | null;
};

export type NewRun = Pick<StoredRun, "id" | "status" | "createdAt" | "expiresAt">;

// The statuses are the discriminator values of the shared RunView, so they cannot drift from it.
const RunStatusSchema = z.enum(RunViewSchema.options.map((option) => option.shape.status.value) as [RunStatus, ...RunStatus[]]);

/** The one place a database row becomes a `StoredRun`: nothing unvalidated leaves the store. */
function toStoredRun(row: Run): StoredRun {
  return {
    id: row.id as RunId,
    status: RunStatusSchema.parse(row.status),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    exportPath: row.exportPath,
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
    return toStoredRun(await this.prisma.run.create({ data: run }));
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
   * Deletes the Run only if its status is not in `busy` and, when `liveAt` is given, it has not expired at that time, in
   * one statement, and says whether it did. Like `claimStatus`, the condition and the delete cannot be split by a
   * simultaneous request.
   */
  async deleteUnless(id: RunId, busy: RunStatus[], liveAt?: Date): Promise<boolean> {
    const { count } = await this.prisma.run.deleteMany({
      where: { id, status: { notIn: busy }, ...(liveAt && { expiresAt: { gt: liveAt } }) },
    });
    return count === 1;
  }

  /** The ids of the Runs that have expired at `now` and whose status is not in `busy`, oldest first. */
  async listExpiredIds(now: Date, busy: RunStatus[]): Promise<RunId[]> {
    const rows = await this.prisma.run.findMany({
      where: { expiresAt: { lte: now }, status: { notIn: busy } },
      select: { id: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => row.id as RunId);
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
