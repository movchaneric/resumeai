import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ChevronDown, History, LogOut, Trash2 } from "lucide-react";
import { signOut } from "@/api";
import { useAccount, useAccountActions } from "@/features/account";
import { Avatar } from "@/features/accountMenu/Avatar";
import { DeleteAccountDialog } from "@/features/accountMenu/DeleteAccountDialog";
import { Menu } from "@/ui/Menu";
import { useToast } from "@/ui/Toast";

const TRIGGER = "h-10 max-w-[200px] gap-2 px-2 text-sm font-semibold text-fg";

/** The header's right edge: "Sign in" for a guest, the avatar menu for an Account, nothing while we don't know yet. */
export function AccountMenu() {
  const { account } = useAccount();
  const { clear } = useAccountActions();
  const navigate = useNavigate();
  const toast = useToast();
  const location = useLocation();
  const [deleting, setDeleting] = useState(false);

  if (account === undefined) return null;
  if (account === null) {
    const here = location.pathname + location.search;
    const to = here === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(here)}`;
    return (
      <Link to={to} className="shrink-0 whitespace-nowrap rounded-sm px-2 py-2 text-sm font-semibold text-accent hover:bg-accent-soft">
        Sign in
      </Link>
    );
  }

  const onSignOut = async () => {
    try {
      await signOut();
    } catch {
      toast.show("Couldn't sign out. Try again.");
      return;
    }
    clear();
    void navigate("/");
  };

  return (
    <>
      <Menu
        label={`Account menu for ${account.name || account.email}`}
        triggerClassName={TRIGGER}
        trigger={
          <>
            <Avatar account={account} />
            <span className="hidden min-w-0 truncate sm:block">{account.name || account.email}</span>
            <ChevronDown aria-hidden="true" size={14} strokeWidth={2} className="shrink-0 text-fg-3" />
          </>
        }
        items={[
          { label: "My Runs", icon: History, onSelect: () => void navigate("/runs") },
          { label: "Sign out", icon: LogOut, onSelect: () => void onSignOut() },
          { label: "Delete account", icon: Trash2, onSelect: () => setDeleting(true), tone: "danger" },
        ]}
      />
      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
    </>
  );
}
