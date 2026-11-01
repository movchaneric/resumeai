import type { EmailKind, EmailSender } from "@/auth/emailSender.js";

export type SentEmail = { kind: EmailKind; to: string; url: string };

/** Records every email instead of sending it, so a test can follow the link in it. */
export class FakeEmailSender implements EmailSender {
  readonly sent: SentEmail[] = [];

  async send(email: SentEmail): Promise<void> {
    this.sent.push(email);
  }

  /** The newest email of a kind to an address. */
  last(kind: EmailKind, to: string): SentEmail {
    const found = this.sent.findLast((email) => email.kind === kind && email.to === to);
    if (!found) throw new Error(`No ${kind} email was sent to ${to}`);
    return found;
  }

  clear(): void {
    this.sent.length = 0;
  }
}
