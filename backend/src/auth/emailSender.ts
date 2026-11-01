/** What an Account email is for. */
export type EmailKind = "verify" | "reset";

/** Sends the emails Better Auth asks for. Injected, so tests record them and a real provider can replace the dev logger. */
export interface EmailSender {
  send(email: { kind: EmailKind; to: string; url: string }): Promise<void>;
}

/** Dev implementation: no mail leaves the machine, the link is written to the log (`backend/logs/dev.log` under `pnpm dev`). */
export class LogEmailSender implements EmailSender {
  async send({ kind, to, url }: { kind: EmailKind; to: string; url: string }): Promise<void> {
    console.log(`[email] ${kind} ${to}: ${url}`);
  }
}
