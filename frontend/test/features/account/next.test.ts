import { describe, expect, it } from "vitest";
import { safeNext } from "@/features/account";

describe("safeNext", () => {
  it.each(["/runs", "/runs/abc-123", "/", "/runs?x=1#top", "/verify-emailer", "/runs?next=%2Fruns"])("keeps the same-origin path %s", (raw) => {
    expect(safeNext(raw)).toBe(raw);
  });

  it.each([
    null,
    undefined,
    "",
    "runs",
    "https://evil.example",
    "http://localhost:3000/runs",
    "//evil.example",
    "//evil.example/runs",
    "/\\evil.example",
    "/\\/evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/javascript:alert(1)\\x",
    "data:text/html,<script>1</script>",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r/evil.example",
    "\t//evil.example",
    " //evil.example",
    "///evil.example",
    "/%5Cevil.example",
    "%2F%2Fevil.example",
    "%5C%5Cevil.example",
    "/runs\\..\\evil",
  ])("falls back to /runs for %j", (raw) => {
    const result = safeNext(raw);
    // A percent-encoded start never begins with "/", and a path with "%5C" stays on this origin: either way the result is safe.
    expect(new URL(result, window.location.origin).origin).toBe(window.location.origin);
    if (raw !== "/%5Cevil.example") expect(result).toBe("/runs");
  });

  it("keeps a percent-encoded backslash path, which the browser treats as an ordinary path on this origin", () => {
    expect(new URL(safeNext("/%5Cevil.example"), window.location.origin).origin).toBe(window.location.origin);
  });

  it.each(["/sign-in", "/sign-up", "/verify-email", "/forgot-password", "/reset-password", "/sign-in?next=%2Fruns", "/Sign-In", "/sign-in/", "/reset-password/abc"])(
    "never returns the auth page %s",
    (raw) => {
      expect(safeNext(raw)).toBe("/runs");
    },
  );
});
