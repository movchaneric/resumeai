import { cx } from "@/ui/cx";

export interface ProgressBarProps {
  value: number;
  max?: number;
  /** The accessible name, for example "Tailoring progress". */
  label: string;
  className?: string;
}

/** A 6px track with an accent fill. `value` is clamped to 0..max. */
export function ProgressBar({ value, max = 100, label, className }: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), max);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamped}
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-soft", className)}
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out" style={{ width: `${(clamped / max) * 100}%` }} />
    </div>
  );
}
