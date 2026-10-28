import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ApiError, deleteRun } from "@/api";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { runKey } from "@/features/run/useRun";

/** Confirms, calls `DELETE /runs/:id`, then goes to `/`. A Run that is already gone counts as deleted. */
export function DeleteRunDialog({ runId, open, onOpenChange }: { runId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => deleteRun(runId),
    onSuccess: () => {
      void navigate("/");
      client.removeQueries({ queryKey: runKey(runId) });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.isNotFound) {
        void navigate("/");
        client.removeQueries({ queryKey: runKey(runId) });
      }
    },
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) mutation.reset();
        onOpenChange(next);
      }}
      title="Delete this Run?"
      description="This removes your CV, the Job Description and the Tailored CV for good. It can't be undone."
      confirmLabel="Delete Run"
      busyLabel="Deleting…"
      tone="danger"
      busy={mutation.isPending}
      error={mutation.isError && !(mutation.error instanceof ApiError && mutation.error.isNotFound) ? "Couldn't delete the Run. Try again." : null}
      onConfirm={() => mutation.mutate()}
    />
  );
}
