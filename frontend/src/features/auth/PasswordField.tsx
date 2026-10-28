import { useId, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, Check, Eye, EyeOff } from "lucide-react";
import { cx } from "@/ui/cx";

interface PasswordFieldProps {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  autoComplete: "current-password" | "new-password";
  /** Sits on the label row, to the right. */
  labelAction?: ReactNode;
  /** Live rule line ("At least 10 characters"); turns into a check when met. */
  rule?: { text: string; met: boolean };
}

export function PasswordField({ value, onChange, onBlur, error, autoComplete, labelAction, rule }: PasswordFieldProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const errorId = `${id}-error`;
  const ruleId = `${id}-rule`;
  const describedBy = [error && errorId, rule && ruleId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-fg">
          Password
        </label>
        {labelAction}
      </div>
      <div className="relative">
        <input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={cx("w-full rounded-input bg-surface py-2.5 pl-3 pr-11 text-[15px] text-fg ring-1", error ? "ring-2 ring-danger" : "ring-fg-3")}
        />
        <button
          type="button"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          onClick={() => setShown((s) => !s)}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-input text-fg-2 hover:text-fg"
        >
          {shown ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
        </button>
      </div>
      {error && (
        <p id={errorId} className="flex items-center gap-1.5 text-[13px] text-danger">
          <AlertCircle aria-hidden="true" size={16} strokeWidth={2} />
          {error}
        </p>
      )}
      {rule && (
        <p id={ruleId} aria-live="polite" className={cx("flex items-center gap-1.5 text-[13px]", rule.met ? "text-ok" : "text-fg-3")}>
          {rule.met && <Check aria-hidden="true" size={16} strokeWidth={2.5} />}
          {rule.text}
          {rule.met && <span className="sr-only"> (met)</span>}
        </p>
      )}
    </div>
  );
}
