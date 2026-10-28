import { useSyncExternalStore } from "react";

export const SHORTCUTS_KEY = "resume-ai:shortcuts";

const listeners = new Set<() => void>();
/** Used only while storage is unavailable (a private window, blocked site data), so the toggle still works for the visit. */
let fallback: boolean | null = null;

function read(): boolean {
  try {
    const stored = window.localStorage.getItem(SHORTCUTS_KEY);
    if (stored !== null) return stored !== "off";
  } catch {
    // Storage is unavailable: use the in-memory value.
  }
  return fallback ?? true;
}

function write(enabled: boolean): void {
  try {
    window.localStorage.setItem(SHORTCUTS_KEY, enabled ? "on" : "off");
    fallback = null;
  } catch {
    fallback = enabled;
  }
  listeners.forEach((notify) => notify());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Single-key shortcuts are on by default and the user can switch them off (WCAG 2.1.4). The choice is kept in `localStorage`. */
export function useShortcuts(): [enabled: boolean, setEnabled: (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, read, () => true);
  return [enabled, write];
}

/** True when the key press comes from somewhere the user is typing. */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !["radio", "checkbox", "button", "submit", "reset"].includes(target.type);
  return false;
}
