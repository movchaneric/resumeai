import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, deleteRun } from "@/api";
import { myRunsKey } from "@/features/account";
import { runKey } from "@/features/run/useRun";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/Toast";

/** Confirms, calls `DELETE /runs/:id`, then refreshes My Runs. A Run that is already gone counts as deleted. Stays on the page. */
export function DeleteOwnedRunDialog({ runId, open, onOpenChange }: { runId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const client = useQueryClient();
  const toast = useToast();
  const done = () => {
    onOpenChange(false);
    client.removeQueries({ queryKey: runKey(runId) });
    void client.invalidateQueries({ queryKey: myRunsKey });
    toast.show("Run deleted.");
  };
  const mutation = useMutation({
    mutationFn: () => deleteRun(runId),
    onSuccess: done,
    onError: (error) => {
      if (error instanceof ApiError && error.isNotFound) done();
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
