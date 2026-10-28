import { useState } from "react";
import { Link2, Trash2 } from "lucide-react";
import { Button } from "@/ui/Button";
import { Menu } from "@/ui/Menu";
import { useToast } from "@/ui/Toast";
import { DeleteRunDialog } from "@/features/run/DeleteRunDialog";

/** The header controls on a Run page: "Copy link to this Run" and the ⋯ menu (Copy link, Delete Run). */
export function RunActions({ runId }: { runId: string }) {
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.show("Link copied");
    } catch {
      toast.show("Couldn't copy the link");
    }
  };

  return (
    <>
      <Button variant="secondary" size="compact" onClick={copyLink} className="shrink-0 whitespace-nowrap max-sm:px-3">
        <Link2 aria-hidden="true" size={16} strokeWidth={2} />
        <span className="sr-only sm:not-sr-only">Copy link to this Run</span>
      </Button>
      <Menu
        label="Run options"
        items={[
          { label: "Copy link", icon: Link2, onSelect: copyLink },
          { label: "Delete Run", icon: Trash2, onSelect: () => setDeleting(true), tone: "danger" },
        ]}
      />
      <DeleteRunDialog runId={runId} open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
