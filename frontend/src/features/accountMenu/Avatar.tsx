import { useState } from "react";
import type { Account } from "@resume-ai/shared";

/** The Google picture, or the first letter of the name in a circle. Decorative: the name sits beside it. */
export function Avatar({ account }: { account: Pick<Account, "name" | "email" | "image"> }) {
  const [broken, setBroken] = useState(false);
  const initial = (account.name.trim() || account.email.trim()).charAt(0).toUpperCase() || "?";
  if (account.image && !broken) {
    return (
      <img
        src={account.image}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="size-7 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-fg">
      {initial}
    </span>
  );
}
