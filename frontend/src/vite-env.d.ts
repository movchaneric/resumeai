/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The API base. Defaults to `/api` (the Vite dev proxy). */
  readonly VITE_API_BASE?: string;
}
