import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

/** Our tables live in the `app` schema; the LangGraph checkpointer gets its own (ADR 0005). */
export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }, { schema: "app" }) });
}
