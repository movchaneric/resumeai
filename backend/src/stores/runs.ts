import {
  CoverageSchema,
  CvSchema,
  JobProfileSchema,
  RunErrorCodeSchema,
  RunViewSchema,
  type Coverage,
  type Cv,
  type JobProfile,
  type RunErrorCode,
  type RunId,
  type RunStatus,
} from "@resume-ai/shared";
import { z } from "zod";
import type { PrismaClient, Run } from "@/generated/prisma/client.js";

export type StoredRun = {
  id: RunId;
  status: RunStatus;
  createdAt: Date;
  expiresAt: Date;
  exportPath: string | null;
  /** Transitional (ADR 0003): slice 4 moves the text into graph state and drops these. */
  cvText: string;
  jobDescriptionText: string;
  /** Transitional (ADR 0003, slice 2 extension): the extraction results, dropped in slice 4. */
  cv: Cv | null;
  jobProfile: JobProfile | null;
  /** Transitional (ADR 0003, slice 3 extension): the Coverage verdicts, dropped in slice 4. */
  coverage: Coverage[] | null;
  error: { code: RunErrorCode; message: string } | null;
};

export type NewRun = Pick<StoredRun, "id" | "status" | "createdAt" | "expiresAt" | "cvText" | "jobDescriptionText">;

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
    cvText: row.cvText,
    jobDescriptionText: row.jobDescriptionText,
    cv: row.cv === null ? null : CvSchema.parse(row.cv),
    jobProfile: row.jobProfile === null ? null : JobProfileSchema.parse(row.jobProfile),
    coverage: row.coverage === null ? null : z.array(CoverageSchema).parse(row.coverage),
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

  /** Stores both extraction results on a Run. The Run stays `extracting`: later slices move it on. */
  async saveExtraction(id: RunId, { cv, jobProfile }: { cv: Cv; jobProfile: JobProfile }): Promise<void> {
    await this.prisma.run.updateMany({ where: { id }, data: { cv, jobProfile } });
  }

  /** Stores the Coverage verdicts and moves the Run to `scored`. */
  async saveCoverage(id: RunId, coverage: Coverage[]): Promise<void> {
    await this.prisma.run.updateMany({ where: { id }, data: { coverage, status: "scored" } });
  }

  async markFailed(id: RunId, code: RunErrorCode, message: string): Promise<void> {
    await this.prisma.run.updateMany({ where: { id }, data: { status: "failed", errorCode: code, errorMessage: message } });
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
