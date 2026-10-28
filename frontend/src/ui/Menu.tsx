import type { ComponentType, ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { cx } from "@/ui/cx";

export interface MenuItem {
  label: string;
  icon?: ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
  onSelect: () => void;
  /** `danger` colors the item with `--danger` (Delete Run). */
  tone?: "default" | "danger";
}

export interface MenuProps {
  /** The accessible name of the ⋯ button, for example "Run options". */
  label: string;
  items: MenuItem[];
  trigger?: ReactNode;
}

/** An icon button (⋯) that opens a menu of actions. */
export function Menu({ label, items, trigger }: MenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={label}
        className="inline-flex size-10 items-center justify-center rounded-btn text-fg-2 transition-colors duration-150 hover:bg-soft data-[state=open]:bg-soft"
      >
        {trigger ?? <MoreHorizontal aria-hidden="true" size={18} strokeWidth={2} />}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-40 min-w-48 rounded-btn bg-surface p-1.5 shadow-lg ring-1 ring-line">
          {items.map(({ label: itemLabel, icon: Icon, onSelect, tone = "default" }) => (
            <DropdownMenu.Item
              key={itemLabel}
              onSelect={onSelect}
              className={cx(
                "flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm font-semibold outline-none data-[highlighted]:bg-soft",
                tone === "danger" ? "text-danger" : "text-fg",
              )}
            >
              {Icon && <Icon aria-hidden={true} size={16} strokeWidth={2} />}
              {itemLabel}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
