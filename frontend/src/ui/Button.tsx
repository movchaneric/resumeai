import type { ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cx } from "@/ui/cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "flow" | "compact";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** `flow` is 48px tall (Upload, Questions); `compact` is 40px (the Review bar). */
  size?: ButtonSize;
  /** Keeps the width, shows a spinner and disables the button. Put the verb in the children ("Uploading…"). */
  busy?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-fg text-surface hover:bg-fg-2 rounded-btn px-5 font-semibold",
  secondary: "bg-surface text-fg ring-1 ring-fg-3 hover:bg-soft rounded-btn px-5 font-semibold",
  ghost: "text-accent hover:bg-accent-soft rounded-sm px-2 font-semibold",
  danger: "text-danger hover:bg-soft rounded-sm px-2 font-semibold",
};

export function Button({ variant = "primary", size = "flow", busy = false, className, children, disabled, type = "button", ...rest }: ButtonProps) {
  const height = variant === "ghost" || variant === "danger" ? "min-h-10" : size === "flow" ? "min-h-12" : "min-h-10";
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 text-[15px] transition-colors duration-150 ease-out disabled:opacity-50",
        height,
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {busy && <Loader2 aria-hidden="true" size={16} strokeWidth={2} className="animate-spin motion-reduce:animate-none" />}
      {children}
    </button>
  );
}
