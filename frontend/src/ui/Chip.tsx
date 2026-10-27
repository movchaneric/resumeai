import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/ui/cx";

export type ChipVariant = "status" | "badge" | "delta" | "warn";

const VARIANT: Record<ChipVariant, string> = {
  status: "bg-surface text-fg ring-1 ring-fg-3",
  badge: "bg-accent-soft text-accent-fg",
  delta: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn-fg ring-1 ring-warn-line",
};

const BASE = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums";

export interface ChipProps {
  variant?: ChipVariant;
  /** Gives a pill that opens details: it renders a button instead of a span. */
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>["onClick"];
  className?: string;
  children: ReactNode;
}

/** A pill: a status (fit, score), a type badge ("Rewording"), a delta ("+16") or a warning. Always carries text, never color alone. */
export function Chip({ variant = "status", onClick, className, children }: ChipProps) {
  const classes = cx(BASE, VARIANT[variant], onClick && "transition-colors duration-150 hover:bg-soft", className);
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes}>
        {children}
      </button>
    );
  }
  return <span className={classes}>{children}</span>;
}
