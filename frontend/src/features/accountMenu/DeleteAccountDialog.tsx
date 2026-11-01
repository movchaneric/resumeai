import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ApiError, deleteAccount } from "@/api";
import { useAccountActions, useMyRuns } from "@/features/account";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { useToast } from "@/ui/Toast";

function runsPhrase(count: number | undefined): string {
  if (count === undefined) return "all your Runs";
  return `all ${count === 1 ? "1 Run" : `${count} Runs`}`;
}

/** Confirms, calls `DELETE /account`, then drops the session data, goes to `/` and says so. */
export function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { clear } = useAccountActions();
  const runs = useMyRuns({ enabled: open });
  const count = runs.data?.runs.length;
  const mutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      onOpenChange(false);
      clear();
      void navigate("/");
      toast.show("Account deleted.");
    },
  });
  const error = !mutation.isError
    ? null
    : mutation.error instanceof ApiError && mutation.error.code === "RUN_BUSY"
      ? "A Run is still working. Try again when it finishes."
      : "Couldn't delete your account. Try again.";
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) mutation.reset();
        onOpenChange(next);
      }}
      title="Delete your account?"
      description={`Deletes your account and ${runsPhrase(count)}. This can't be undone.`}
      confirmLabel="Delete account"
      busyLabel="Deleting…"
      tone="danger"
      busy={mutation.isPending}
      error={error}
      onConfirm={() => mutation.mutate()}
    />
  );
}
