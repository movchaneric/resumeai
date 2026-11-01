/** Where a person lands when `next` is missing or unsafe. */
export const DEFAULT_NEXT = "/runs";

/** Pages of the sign-in flow. Sending someone back to one after signing in would loop. */
const AUTH_PATHS = ["/sign-in", "/sign-up", "/verify-email", "/forgot-password", "/reset-password"];

// eslint-disable-next-line no-control-regex -- control characters are exactly what is being rejected
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * The `next` query value is attacker-controlled (a link can carry any). Returns it only when it is a same-origin path:
 * one leading `/`, no `//` or `/\` start, no backslash or control character anywhere, still same-origin once the browser
 * parses it, and not an auth page. Anything else gives `/runs`.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || CONTROL.test(raw)) return DEFAULT_NEXT;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return DEFAULT_NEXT;
  }
  if (url.origin !== window.location.origin) return DEFAULT_NEXT;
  const path = url.pathname.toLowerCase().replace(/\/+$/, "");
  if (AUTH_PATHS.some((auth) => path === auth || path.startsWith(`${auth}/`))) return DEFAULT_NEXT;
  return raw;
}
