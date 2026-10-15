import type { RunId } from "@resume-ai/shared";
import type { PrismaClient } from "@/generated/prisma/client.js";

export type StoredRun = {
  id: RunId;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  exportPath: string | null;
  /** Transitional (ADR 0003): slice 4 moves the text into graph state and drops these. */
  cvText: string;
  jdText: string;
};

export type NewRun = Pick<StoredRun, "id" | "status" | "expiresAt" | "cvText" | "jdText">;

/** Run metadata in Postgres. Nothing outside this module knows it is Prisma. */
export class RunStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(run: NewRun): Promise<StoredRun> {
    return (await this.prisma.run.create({ data: run })) as StoredRun;
  }

  async get(id: RunId): Promise<StoredRun | null> {
    return (await this.prisma.run.findUnique({ where: { id } })) as StoredRun | null;
  }

  async delete(id: RunId): Promise<void> {
    await this.prisma.run.deleteMany({ where: { id } });
  }
}
