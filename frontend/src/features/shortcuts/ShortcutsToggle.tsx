import { useShortcuts } from "@/features/shortcuts/useShortcuts";

/** The "Keyboard shortcuts" switch: single-key shortcuts can be turned off. */
export function ShortcutsToggle() {
  const [enabled, setEnabled] = useShortcuts();
  return (
    <label className="inline-flex items-center gap-2 text-[13px] text-fg-2">
      <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-accent" />
      Keyboard shortcuts
    </label>
  );
}
