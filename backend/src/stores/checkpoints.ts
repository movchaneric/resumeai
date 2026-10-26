import type { PrismaClient } from "@/generated/prisma/client.js";

/**
 * The checkpointer's tables (ADR 0005): their own schema, which Prisma does not manage, so this store uses raw SQL.
 * Deleting one Run's thread goes through the checkpointer (`GraphRunner.deleteThread`); this is only the orphan scan.
 */
export class CheckpointStore {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Deletes the rows of every checkpoint table whose `thread_id` has no row in `app.runs`, and returns how many rows
   * went. A live Run's thread never looks orphaned: `createRun` inserts the Run row before the graph starts, so the
   * first checkpoint always has a Run row, and a Run's row is deleted before its thread (`purgeRun`), never after.
   */
  async deleteOrphans(): Promise<number> {
    const counts = await this.prisma.$transaction([
      this.prisma
        .$executeRaw`DELETE FROM checkpoints.checkpoint_writes t WHERE NOT EXISTS (SELECT 1 FROM app.runs r WHERE r.id::text = t.thread_id)`,
      this.prisma
        .$executeRaw`DELETE FROM checkpoints.checkpoint_blobs t WHERE NOT EXISTS (SELECT 1 FROM app.runs r WHERE r.id::text = t.thread_id)`,
      this.prisma
        .$executeRaw`DELETE FROM checkpoints.checkpoints t WHERE NOT EXISTS (SELECT 1 FROM app.runs r WHERE r.id::text = t.thread_id)`,
    ]);
    return counts.reduce((sum, n) => sum + n, 0);
  }
}
