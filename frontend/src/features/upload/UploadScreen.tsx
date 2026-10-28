import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { FileUp } from "lucide-react";
import { createRun } from "@/api";
import { CvPane } from "@/features/upload/CvPane";
import { ProblemNote } from "@/features/upload/Problem";
import {
  MAX_JD_CHARS,
  MISSING_FILE,
  MISSING_JD,
  checkFile,
  checkJobDescription,
  rejectionFor,
  type Pane,
  type Problem,
} from "@/features/upload/uploadErrors";
import { useDropAnywhere } from "@/features/upload/useDropAnywhere";
import { Button } from "@/ui/Button";
import { cx } from "@/ui/cx";

type Errors = Partial<Record<Pane, Problem>>;

const STEPS = ["We read both.", "You fill the gaps (up to 5 questions).", "You approve every change, then download a one-page PDF or Word file."];

export function UploadScreen() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [jd, setJd] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [focusKey, setFocusKey] = useState(0); // bumps when a submit leaves errors, so the focus moves even to the same pane again
  const fileRef = useRef<HTMLInputElement>(null);
  const jdRef = useRef<HTMLTextAreaElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);
  const ids = useId();

  const mutation = useMutation({
    mutationFn: createRun,
    onSuccess: (id) => navigate(`/runs/${id}`),
    onError: (error) => {
      const { pane, title, hint } = rejectionFor(error);
      setErrors({ [pane]: { title, hint } });
      setFocusKey((k) => k + 1);
    },
  });

  const pick = (picked: File) => {
    setFile(picked);
    setErrors((e) => ({ ...e, cv: checkFile(picked) ?? undefined, form: undefined }));
  };
  const dragging = useDropAnywhere(pick);

  useEffect(() => {
    if (focusKey === 0) return;
    if (errors.cv) fileRef.current?.focus();
    else if (errors.jd) jdRef.current?.focus();
    else if (errors.form) formErrorRef.current?.focus();
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps -- only a submit moves the focus

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Errors = {};
    if (!file) next.cv = MISSING_FILE;
    else {
      const bad = checkFile(file);
      if (bad) next.cv = bad;
    }
    if (!jd.trim()) next.jd = MISSING_JD;
    else {
      const bad = checkJobDescription(jd);
      if (bad) next.jd = bad;
    }
    setErrors(next);
    if (next.cv || next.jd) {
      setFocusKey((k) => k + 1);
      return;
    }
    mutation.mutate({ cv: file!, jobDescription: jd });
  };

  const jdId = `${ids}-jd`;
  const jdHelperId = `${jdId}-helper`;
  const jdErrorId = `${jdId}-error`;
  const busy = mutation.isPending;

  return (
    <div className="mx-auto flex w-full max-w-[960px] flex-col gap-10 px-4 py-10 md:px-6 md:py-14">
      {dragging && (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-accent-soft/95 text-accent-fg">
          <FileUp size={48} strokeWidth={1.5} />
          <p className="text-3xl font-bold">Drop your CV</p>
        </div>
      )}
      <header className="flex flex-col gap-4">
        <h1 className="max-w-[16ch] text-[32px] leading-[1.1] md:text-[44px]">Tailor your CV to the job you want</h1>
        <p className="max-w-[60ch] text-[17px] text-fg-2">
          It rewords and reorders what&apos;s already in your CV, asks about the gaps, and lets you approve every change. It never invents facts.
        </p>
      </header>

      <form onSubmit={submit} noValidate className="overflow-hidden rounded-hero bg-surface shadow-sm ring-1 ring-line">
        <div className="grid min-[720px]:grid-cols-2">
          <CvPane ref={fileRef} file={file} error={errors.cv ?? null} onPick={pick} />
          <div className="flex flex-col gap-3 bg-bg p-5 min-[720px]:p-6">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={jdId} className="text-sm font-semibold">
                Job Description
              </label>
              <span className={cx("text-[13px] tabular-nums", jd.length > MAX_JD_CHARS ? "font-semibold text-danger" : "text-fg-3")}>
                {jd.length.toLocaleString("en-US")} / {MAX_JD_CHARS.toLocaleString("en-US")}
              </span>
            </div>
            <textarea
              ref={jdRef}
              id={jdId}
              rows={7}
              value={jd}
              onChange={(e) => {
                setJd(e.target.value);
                if (errors.jd) setErrors((x) => ({ ...x, jd: undefined }));
              }}
              aria-invalid={errors.jd ? true : undefined}
              aria-describedby={[errors.jd && jdErrorId, jdHelperId].filter(Boolean).join(" ")}
              className={cx("w-full resize-y rounded-input bg-surface px-3 py-2.5 text-[15px] text-fg ring-1", errors.jd ? "ring-2 ring-danger" : "ring-fg-3")}
            />
            {errors.jd && <ProblemNote id={jdErrorId} problem={errors.jd} />}
            <p id={jdHelperId} className="text-[13px] text-fg-3">
              Paste the whole posting, requirements included.
            </p>
          </div>
        </div>

        {errors.form && (
          <div ref={formErrorRef} tabIndex={-1} className="border-t border-line px-5 py-3 md:px-6">
            <ProblemNote id={`${ids}-form-error`} problem={errors.form} />
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-line px-5 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <p className="text-[13px] text-fg-3">No account needed · Deleted after 7 days, or sooner if you ask</p>
          <Button type="submit" busy={busy} className="w-full md:w-auto">
            {busy ? "Uploading…" : "Tailor my CV →"}
          </Button>
        </div>
        <p role="status" className="sr-only">
          {busy ? "Uploading your CV and Job Description." : ""}
        </p>
      </form>

      <section aria-labelledby={`${ids}-how`} className="flex flex-col gap-4">
        <h2 id={`${ids}-how`} className="text-xl">
          How it works
        </h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-start gap-3 text-[15px] text-fg-2">
              <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent-fg">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
