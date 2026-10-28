import { useEffect, useState } from "react";

const QUERY = "(min-width: 1024px)";

const read = () => (typeof window.matchMedia === "function" ? window.matchMedia(QUERY).matches : true);

/** True from 1024px up (the desktop layout). Subscribes to changes. Without `matchMedia` it is true. */
export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(read);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(QUERY);
    const onChange = () => setDesktop(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);
  return desktop;
}
