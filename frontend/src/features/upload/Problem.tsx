import { AlertCircle } from "lucide-react";
import type { Problem as ProblemData } from "@/features/upload/uploadErrors";

/** An inline rejection: an icon, a title and the next step. */
export function ProblemNote({ id, problem }: { id: string; problem: ProblemData }) {
  return (
    <div id={id} className="flex items-start gap-2 text-[13px] text-danger">
      <AlertCircle aria-hidden="true" size={16} strokeWidth={2} className="mt-0.5 shrink-0" />
      <p>
        <span className="font-semibold">{problem.title}</span> {problem.hint}
      </p>
    </div>
  );
}
