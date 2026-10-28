import { forwardRef, useId } from "react";
import { Check, FileText, Upload } from "lucide-react";
import { ProblemNote } from "@/features/upload/Problem";
import { describeFile, type Problem } from "@/features/upload/uploadErrors";
import { cx } from "@/ui/cx";

interface CvPaneProps {
  file: File | null;
  error: Problem | null;
  onPick: (file: File) => void;
}

/** The CV half of the form: a real file input, labelled, with a drop target or the chosen file. */
export const CvPane = forwardRef<HTMLInputElement, CvPaneProps>(function CvPane({ file, error, onPick }, ref) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error && errorId, !file && hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-3 p-5 md:p-6">
      <h2 className="text-sm font-semibold">Your CV</h2>
      <input
        ref={ref}
        id={id}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="peer sr-only"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onPick(picked);
          e.target.value = ""; // choosing the same file again still fires
        }}
      />
      {file ? (
        <div className="flex items-center gap-3 rounded-input bg-surface p-3 ring-1 ring-line">
          <FileText aria-hidden="true" size={24} strokeWidth={1.75} className="shrink-0 text-fg-2" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{file.name}</p>
            <p className="text-[13px] text-fg-3">{describeFile(file)}</p>
          </div>
          {!error && <Check aria-label="Ready" size={20} strokeWidth={2.5} className="shrink-0 text-ok" />}
        </div>
      ) : (
        <label
          htmlFor={id}
          className={cx(
            "flex min-h-40 flex-col items-center justify-center gap-2 rounded-tile border-2 border-dashed bg-surface px-4 py-6 text-center transition-colors duration-150 hover:bg-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
            error ? "border-danger" : "border-fg-3",
          )}
        >
          <Upload aria-hidden="true" size={24} strokeWidth={1.75} className="text-fg-2" />
          <span className="text-[15px] font-semibold">Choose a file or drop it here</span>
          <span id={hintId} className="text-[13px] text-fg-3">
            PDF or Word, up to 5 MB and 5 pages
          </span>
        </label>
      )}
      {file && (
        <label htmlFor={id} className="w-fit rounded-sm px-2 py-2 text-sm font-semibold text-accent hover:bg-accent-soft peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
          Choose a different file
        </label>
      )}
      {error && <ProblemNote id={errorId} problem={error} />}
    </div>
  );
});
