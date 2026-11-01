import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { RunIdSchema, type RunId } from "@resume-ai/shared";
import request from "supertest";
import { createApp } from "@/app.js";
import { createAuth, type GoogleStub } from "@/auth/betterAuth.js";
import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import { RunsService } from "@/services/runs.js";
import { RunStore } from "@/stores/runs.js";
import { loadConfig } from "@/utils/config.js";
import { createPrisma } from "@/utils/db.js";
import { InProcessRunEvents } from "@/utils/runEvents.js";
import { FakeEmailSender } from "./emailSender.js";
import { GatedLlm } from "./gatedLlm.js";
import { enqueueToReview } from "./reviewRun.js";
import { makeGraphRunner } from "./runGraph.js";

export const APP_ORIGIN = "http://localhost:5173";

const cvFile = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));
const JOB_DESCRIPTION = "We are hiring a backend developer with Node.js experience.";

export type TestUser = { name: string; email: string; password: string };

type AuthAppOptions = { checkpointer?: BaseCheckpointSaver; now?: () => Date };

/**
 * The app with the real Better Auth on the test database and a `FakeEmailSender`. `env` overrides the test environment
 * (for example to switch Google or rate limiting on). Runs use a `GatedLlm` and the in-memory checkpointer unless
 * `checkpointer` says otherwise; their background work is collected, and `settle` waits for it.
 */
export function makeAuthApp(env: Record<string, string> = {}, googleStub?: GoogleStub, { checkpointer = createMemoryCheckpointer(), now }: AuthAppOptions = {}) {
  const config = loadConfig({ ...process.env, ...env });
  const prisma = createPrisma(config.databaseUrl);
  const emails = new FakeEmailSender();
  const auth = createAuth({ prisma, config, emailSender: emails, googleStub });
  const store = new RunStore(prisma);
  const llm = new GatedLlm();
  const events = new InProcessRunEvents();
  const tasks: Promise<void>[] = [];
  const deps = { store, config, graphRunner: makeGraphRunner(store, llm, llm, undefined, events, checkpointer), events, now, runInBackground: (task: () => Promise<void>) => void tasks.push(task()) };
  const service = new RunsService(deps);
  const app = createApp(deps, service, undefined, auth);

  /** Waits for the background work of every Run started so far. */
  const settle = async () => {
    await Promise.all(tasks.splice(0));
  };

  /** Empties Better Auth's tables, so a test starts from nothing. The Owned Runs go first: their foreign key refuses the user. */
  const clearAuthTables = async () => {
    await prisma.run.deleteMany({ where: { accountId: { not: null } } });
    await prisma.session.deleteMany();
    await prisma.authAccount.deleteMany();
    await prisma.verification.deleteMany();
    await prisma.user.deleteMany();
  };

  /** Signs the user up, follows the verification link, signs in, and returns the session cookie. */
  const signUpAndIn = async (user: TestUser): Promise<string> => {
    await request(app).post("/api/auth/sign-up/email").set("Origin", APP_ORIGIN).send(user);
    const { pathname, search } = new URL(emails.last("verify", user.email).url);
    await request(app).get(pathname + search);
    const res = await request(app).post("/api/auth/sign-in/email").set("Origin", APP_ORIGIN).send({ email: user.email, password: user.password });
    return (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
  };

  /** Starts a Run (as the cookie's Account, or as a guest without one) and waits until it is waiting for review, skipping its Questions. */
  const startRun = async (cookie?: string): Promise<RunId> => {
    // A Run that ended without using every queued response must not feed the next one.
    llm.clearQueues();
    enqueueToReview(llm);
    const created = request(app).post("/runs").attach("cv", cvFile, "cv.pdf").field("jobDescription", JOB_DESCRIPTION);
    const res = await (cookie ? created.set("Cookie", cookie) : created);
    const id = RunIdSchema.parse(res.body.id);
    await settle();
    const answers = request(app).post(`/runs/${id}/answers`).send({ answers: [] });
    await (cookie ? answers.set("Cookie", cookie) : answers);
    await settle();
    return id;
  };

  return { app, prisma, store, service, emails, auth, llm, settle, clearAuthTables, signUpAndIn, startRun };
}
