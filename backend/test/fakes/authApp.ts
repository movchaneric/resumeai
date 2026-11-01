import { createApp } from "@/app.js";
import { createAuth, type GoogleStub } from "@/auth/betterAuth.js";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import { FakeEmailSender } from "./emailSender.js";
import { FakeLlmClient } from "./fakeLlmClient.js";
import { makeGraphRunner } from "./runGraph.js";

export const APP_ORIGIN = "http://localhost:5173";

/** The app with the real Better Auth on the test database and a `FakeEmailSender`. `env` overrides the test environment (for example to switch Google or rate limiting on). */
export function makeAuthApp(env: Record<string, string> = {}, googleStub?: GoogleStub) {
  const config = loadConfig({ ...process.env, ...env });
  const prisma = createPrisma(config.databaseUrl);
  const emails = new FakeEmailSender();
  const auth = createAuth({ prisma, config, emailSender: emails, googleStub });
  const store = new RunStore(prisma);
  const llm = new FakeLlmClient();
  const events = new InProcessRunEvents();
  const app = createApp({ store, config, graphRunner: makeGraphRunner(store, llm, llm, undefined, events), events }, undefined, undefined, auth);

  /** Empties Better Auth's tables, so a test starts from nothing. */
  const clearAuthTables = async () => {
    await prisma.session.deleteMany();
    await prisma.authAccount.deleteMany();
    await prisma.verification.deleteMany();
    await prisma.user.deleteMany();
  };
  return { app, prisma, emails, auth, clearAuthTables };
}
