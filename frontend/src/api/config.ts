/** The API base: `/api` by default, which the Vite dev proxy forwards to the backend (stripping `/api`). */
export function apiBase(): string {
  const base = (import.meta.env.VITE_API_BASE as string | undefined) || "/api";
  return base.replace(/\/+$/, "");
}

export function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}
