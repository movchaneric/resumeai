import type { ReactNode } from "react";
import { cx } from "@/ui/cx";

/** A keyboard-shortcut hint shown next to the action it triggers. */
export function Kbd({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <kbd className={cx("inline-block rounded-sm bg-soft px-1.5 font-sans text-[11px] font-semibold text-fg-2 border border-b-2 border-line", className)}>
      {children}
    </kbd>
  );
}
