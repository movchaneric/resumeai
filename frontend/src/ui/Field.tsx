import { useId } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { AlertCircle } from "lucide-react";
import { cx } from "@/ui/cx";

interface FieldCommon {
  label: string;
  /** Helper or counter text below the control. */
  helper?: string;
  /** The error message; sets `aria-invalid` and turns the ring `--danger`. */
  error?: string;
}

export type FieldProps =
  | (FieldCommon & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, "id">)
  | (FieldCommon & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id">);

/** A labelled input or textarea, with helper text and an error linked through `aria-describedby`. */
export function Field(props: FieldProps) {
  const id = useId();
  const { label, helper, error, multiline, className, ...rest } = props;
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy = [error && errorId, helper && helperId].filter(Boolean).join(" ") || undefined;
  const control = cx(
    "w-full rounded-input bg-surface px-3 py-2.5 text-[15px] text-fg ring-1 transition-shadow duration-150 placeholder:text-fg-3",
    error ? "ring-2 ring-danger" : "ring-fg-3",
    className,
  );
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-fg">
        {label}
      </label>
      {multiline ? (
        <textarea id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={control} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <input id={id} aria-invalid={error ? true : undefined} aria-describedby={describedBy} className={control} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />
      )}
      {error && (
        <p id={errorId} className="flex items-center gap-1.5 text-[13px] text-danger">
          <AlertCircle aria-hidden="true" size={16} strokeWidth={2} />
          {error}
        </p>
      )}
      {helper && (
        <p id={helperId} className="text-[13px] text-fg-3">
          {helper}
        </p>
      )}
    </div>
  );
}
