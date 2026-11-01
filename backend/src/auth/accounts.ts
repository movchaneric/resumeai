import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import type { PrismaClient } from "@/generated/prisma/client.js";

/** The signed-in person, as the rest of the backend sees them. Nothing outside `auth/` sees Better Auth's own types. */
export type Account = { accountId: string; name: string; email: string };

/** The one thing the service needs from Better Auth: the session behind a set of headers. */
export type GetSession = (headers: Headers) => Promise<{ user: { id: string; name: string; email: string } } | null>;

export class AccountsService {
  constructor(
    private readonly getSession: GetSession,
    private readonly prisma: PrismaClient,
  ) {}

  /** The Account behind the request's session cookie, or `null` for a guest (no cookie, an expired or a signed-out session). */
  async accountOf(req: Pick<Request, "headers">): Promise<Account | null> {
    const session = await this.getSession(fromNodeHeaders(req.headers));
    if (!session) return null;
    return { accountId: session.user.id, name: session.user.name, email: session.user.email };
  }

  /**
   * Removes the Account's sign-in side: its sessions, its linked accounts (password and Google), the verification and
   * reset rows keyed by its email, and the user, in one transaction. The caller deletes the Account's Runs first; the
   * foreign key from `runs.account_id` refuses the user while any is left.
   */
  async deleteAccount(accountId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: accountId }, select: { email: true } });
    if (!user) return;
    await this.prisma.$transaction([
      this.prisma.session.deleteMany({ where: { userId: accountId } }),
      this.prisma.authAccount.deleteMany({ where: { userId: accountId } }),
      this.prisma.verification.deleteMany({ where: { identifier: user.email } }),
      this.prisma.user.delete({ where: { id: accountId } }),
    ]);
  }
}
