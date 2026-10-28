import { useEffect, useRef } from "react";
import { isTextField, useShortcuts } from "@/features/shortcuts/useShortcuts";

export interface ReviewShortcutHandlers {
  next: () => void;
  previous: () => void;
  accept: () => void;
  reject: () => void;
  edit: () => void;
  drop: () => void;
  undo: () => void;
}

/** Keys that need an open dialog or menu of their own, where a single-key shortcut would be a surprise. */
const OWN_KEYS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * J and K, A, R and E, D, and ⌘Z (Ctrl+Z). They work only outside text fields and dialogs, and only while the
 * "Keyboard shortcuts" switch is on (WCAG 2.1.4). Handlers are read at the time of the key press.
 */
export function useReviewShortcuts(handlers: ReviewShortcutHandlers): void {
  const [enabled] = useShortcuts();
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.target instanceof Element ? e.target : null;
      if (isTextField(e.target) || target?.closest(OWN_KEYS)) return;
      const h = latest.current;
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (key === "z") {
          e.preventDefault();
          h.undo();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const action = { j: h.next, k: h.previous, a: h.accept, r: h.reject, e: h.edit, d: h.drop }[key];
      if (!action) return;
      e.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
