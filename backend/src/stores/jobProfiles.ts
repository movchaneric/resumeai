import { JobProfileSchema, type JobProfile } from "@resume-ai/shared";
import type { PrismaClient } from "@/generated/prisma/client.js";

/**
 * Cached Job Profiles in Postgres (ADR 0007). Satisfies the graph's `JobProfileCache` by shape, so `stores/` does not
 * import `graph/`. Only the key and the profile are stored, never the Job Description text.
 */
export class JobProfileStore {
  /** `ttlMs` is the Run TTL (`config.runTtlMs`): a cached profile lives as long as a Run. */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: { ttlMs: number; now?: () => Date },
  ) {}

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  /** An expired row, or one that no longer parses as a Job Profile, is a miss. */
  async get(key: string): Promise<JobProfile | null> {
    const row = await this.prisma.jobProfile.findUnique({ where: { key } });
    if (!row || row.expiresAt <= this.now()) return null;
    const parsed = JobProfileSchema.safeParse(row.profile);
    return parsed.success ? parsed.data : null;
  }

  /** First write wins: a key that already exists is left as it is. */
  async put(key: string, profile: JobProfile): Promise<void> {
    const createdAt = this.now();
    await this.prisma.jobProfile.createMany({
      data: [{ key, profile, createdAt, expiresAt: new Date(createdAt.getTime() + this.options.ttlMs) }],
      skipDuplicates: true,
    });
  }

  /** Deletes the rows that have expired, in one statement, and returns how many there were. */
  async deleteExpired(): Promise<number> {
    const { count } = await this.prisma.jobProfile.deleteMany({ where: { expiresAt: { lte: this.now() } } });
    return count;
  }
}
