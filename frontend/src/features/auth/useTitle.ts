import { useEffect } from "react";

/** Sets the tab title for an auth page. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Resume AI`;
  }, [title]);
}
