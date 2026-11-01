import type { PrismaClient } from "@/generated/prisma/client.js";
import { AccountsService } from "@/auth/accounts.js";
import type { EmailSender } from "@/auth/emailSender.js";
import type { Config } from "@/utils/config.js";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { toNodeHandler } from "better-auth/node";
import type { RequestHandler } from "express";

/** Where Better Auth lives, as the browser sees it. The Vite proxy forwards `/api/auth` unchanged, because the links and the Google redirect URI are built from this path. */
export const AUTH_BASE_PATH = "/api/auth";

const DAY_SECONDS = 24 * 60 * 60;

/** Tests only: the profile a Google ID token stands for, so a Google sign-in needs no network. */
export type GoogleProfile = { id: string; name: string; email: string; emailVerified: boolean };
export type GoogleStub = (idToken: string) => GoogleProfile;

export type AuthDeps = {
  prisma: PrismaClient;
  config: Pick<Config, "auth">;
  emailSender: EmailSender;
  /** Tests only. */
  googleStub?: GoogleStub;
};

export type Auth = {
  /** Express handler for everything under `AUTH_BASE_PATH`. Mount it before `express.json()`. */
  handler: RequestHandler;
  accounts: AccountsService;
};

/** Builds Better Auth from its dependencies (no module-level instance) and hands back only our own types. */
export function createAuth({ prisma, config, emailSender, googleStub }: AuthDeps): Auth {
  const { auth } = config;
  const instance = betterAuth({
    baseURL: auth.appOrigin,
    basePath: AUTH_BASE_PATH,
    secret: auth.secret,
    trustedOrigins: [auth.appOrigin],
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    // Our Prisma models are named so they do not clash with ours: the account table is `AuthAccount`.
    user: { modelName: "user" },
    session: { modelName: "session", expiresIn: 7 * DAY_SECONDS, updateAge: DAY_SECONDS },
    account: { modelName: "authAccount", accountLinking: { enabled: true, trustedProviders: ["google"] } },
    verification: { modelName: "verification" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await emailSender.send({ kind: "reset", to: user.email, url });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await emailSender.send({ kind: "verify", to: user.email, url });
      },
    },
    ...(auth.google ? { socialProviders: { google: { ...auth.google, ...(googleStub && stubbedGoogle(googleStub)) } } } : {}),
    // Explicit: Better Auth's own default is production only.
    rateLimit: { enabled: auth.rateLimit },
  });
  return {
    handler: toNodeHandler(instance),
    accounts: new AccountsService((headers) => instance.api.getSession({ headers })),
  };
}

function stubbedGoogle(stub: GoogleStub) {
  return {
    verifyIdToken: async () => true,
    // Google's account key is the profile's `sub`.
    getUserInfo: async (tokens: { idToken?: string }) => {
      const user = stub(tokens.idToken ?? "");
      return { user, data: { sub: user.id } } as never;
    },
  };
}
