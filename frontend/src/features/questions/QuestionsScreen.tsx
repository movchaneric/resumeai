import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Answer, RunView } from "@resume-ai/shared";
import { ApiError, answer } from "@/api";
import { runKey } from "@/features/run/useRun";
import { clearDraft, loadDraft, saveDraft, type Choice, type Draft } from "@/features/questions/draft";
import { ShortcutsToggle } from "@/features/shortcuts/ShortcutsToggle";
import { isTextField, useShortcuts } from "@/features/shortcuts/useShortcuts";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { Kbd } from "@/ui/Kbd";
import { cx } from "@/ui/cx";

const MAX_LENGTH = 1000;
const CHOICE_ERROR = "Choose one.";
const TEXT_ERROR = "Describe it in a few words, or choose No.";

type Questions = Extract<RunView, { status: "awaiting_answers" }>["questions"];
type FieldError = { field: "choice" | "text"; message: string };

const OPTIONS: { value: Choice; label: string; sub: string; key: string }[] = [
  { value: "yes", label: "Yes, I've done this", sub: "Describe it below", key: "1" },
  { value: "no", label: "No, I haven't", sub: "It stays a gap", key: "2" },
];

function toAnswers(questions: Questions, draft: Draft): Answer[] {
  return questions.map((q): Answer => {
    const a = draft.answers[q.id];
    return a?.choice === "yes" ? { kind: "has_experience", questionId: q.id, text: a.text.trim() } : { kind: "no_experience", questionId: q.id };
  });
}

/** The `awaiting_answers` screen: one Question at a time; every Answer is sent together at the end. */
export function QuestionsScreen({ run, notice }: { run: Extract<RunView, { status: "awaiting_answers" }>; notice: string }) {
  const { questions } = run;
  const total = questions.length;
  const client = useQueryClient();
  const [shortcuts] = useShortcuts();
  const [draft, setDraft] = useState<Draft>(() => loadDraft(run.id, questions.map((q) => q.id)));
  const [error, setError] = useState<FieldError | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const focusPending = useRef<"text" | "choice" | null>(null);

  const { index } = draft;
  const question = questions[index]!;
  const current = draft.answers[question.id] ?? { choice: null, text: "" };
  const isLast = index === total - 1;

  useEffect(() => saveDraft(run.id, draft), [run.id, draft]);

  const mutation = useMutation({
    mutationFn: (answers: Answer[]) => answer(run.id, answers),
    onSuccess: () => {
      clearDraft(run.id);
      void client.invalidateQueries({ queryKey: runKey(run.id) });
    },
    onError: (e) => {
      setServerError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      focusPending.current = null;
    },
  });
  const sending = mutation.isPending || mutation.isSuccess;

  // Moves the focus after a render, once the field it points at exists.
  useEffect(() => {
    const want = focusPending.current;
    if (!want) return;
    focusPending.current = null;
    const el = want === "text" ? wrapRef.current?.querySelector("textarea") : (wrapRef.current?.querySelector("input[type=radio]:checked") ?? wrapRef.current?.querySelector("input[type=radio]"));
    (el as HTMLElement | null | undefined)?.focus();
  });

  function update(patch: Partial<typeof current>) {
    setDraft((d) => ({ ...d, answers: { ...d.answers, [question.id]: { ...current, ...patch } } }));
    setError(null);
    setServerError(null);
  }

  function choose(choice: Choice) {
    if (sending) return;
    update({ choice });
    if (choice === "yes") focusPending.current = "text";
  }

  function go(to: number) {
    setError(null);
    setServerError(null);
    setDraft((d) => ({ ...d, index: to }));
  }

  function next() {
    if (sending) return;
    if (current.choice === null) {
      focusPending.current = "choice";
      return setError({ field: "choice", message: CHOICE_ERROR });
    }
    if (current.choice === "yes" && current.text.trim() === "") {
      focusPending.current = "text";
      return setError({ field: "text", message: TEXT_ERROR });
    }
    if (!isLast) return go(index + 1);
    setServerError(null);
    mutation.mutate(toAnswers(questions, draft));
  }

  const nextRef = useRef(next);
  nextRef.current = next;
  const chooseRef = useRef(choose);
  chooseRef.current = choose;

  useEffect(() => {
    if (!shortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        nextRef.current();
      } else if ((e.key === "1" || e.key === "2") && !e.metaKey && !e.ctrlKey && !e.altKey && !isTextField(e.target)) {
        e.preventDefault();
        chooseRef.current(e.key === "1" ? "yes" : "no");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts]);

  const status = notice || `Question ${index + 1} of ${total}: ${question.text}`;
  const choiceErrorId = "question-choice-error";

  return (
    <section ref={wrapRef} className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-4 py-10 md:px-6">
      <div className="flex items-center gap-3">
        <div aria-hidden="true" className="flex gap-1.5">
          {questions.map((q, i) => (
            <span key={q.id} className={cx("h-1.5 w-8 rounded-full", i < index ? "bg-ok" : i === index ? "bg-accent" : "bg-line")} />
          ))}
        </div>
        <span className="text-sm font-semibold text-fg-2">
          Question {index + 1} of {total}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold text-accent-fg">A must-have your CV doesn&apos;t clearly show</p>
        <h1 className="text-[30px] leading-tight">{question.text}</h1>
        <p className="text-[17px] text-fg-2">A sentence or two is enough. Saying no is fine: we won&apos;t claim it.</p>
      </div>

      <p role="status" className="sr-only">
        {status}
      </p>

      <div className="flex flex-col gap-2">
        <div
          role="radiogroup"
          aria-label={question.text}
          aria-invalid={error?.field === "choice" ? true : undefined}
          aria-describedby={error?.field === "choice" ? choiceErrorId : undefined}
          className="grid gap-3 sm:grid-cols-2"
        >
          {OPTIONS.map((o) => (
            <label
              key={o.value}
              className={cx(
                "relative flex cursor-pointer flex-col gap-1 rounded-tile bg-surface p-4 ring-1 transition-shadow duration-150 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
                current.choice === o.value ? "bg-accent-soft ring-2 ring-accent" : "ring-fg-3 hover:bg-soft",
              )}
            >
              <input type="radio" name={`answer-${question.id}`} value={o.value} checked={current.choice === o.value} onChange={() => choose(o.value)} className="sr-only" />
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold">{o.label}</span>
                {shortcuts && <Kbd>{o.key}</Kbd>}
              </span>
              <span className="text-sm text-fg-2">{o.sub}</span>
            </label>
          ))}
        </div>
        {error?.field === "choice" && (
          <p id={choiceErrorId} className="text-[13px] text-danger">
            {error.message}
          </p>
        )}
      </div>

      {current.choice === "yes" && (
        <Field
          multiline
          label="What did you build, and with what?"
          rows={5}
          maxLength={MAX_LENGTH}
          value={current.text}
          onChange={(e) => update({ text: e.target.value })}
          helper={`${current.text.length.toLocaleString("en-US")} / ${MAX_LENGTH.toLocaleString("en-US")}`}
          error={error?.field === "text" ? error.message : undefined}
        />
      )}

      {serverError && (
        <p role="alert" className="text-[13px] font-semibold text-danger">
          {serverError}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        {index > 0 ? (
          <Button variant="ghost" disabled={sending} onClick={() => go(index - 1)}>
            ‹ Back
          </Button>
        ) : (
          <span />
        )}
        <Button busy={sending} onClick={next}>
          {sending ? "Starting…" : isLast ? "Start tailoring" : "Next question"}
          {shortcuts && !sending && <Kbd className="ml-1">⌘ Enter</Kbd>}
        </Button>
      </div>

      <ShortcutsToggle />
    </section>
  );
}
