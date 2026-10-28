const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_PASSWORD = 10;

export function nameError(value: string): string | undefined {
  return value.trim() ? undefined : "Enter your name.";
}

export function emailError(value: string): string | undefined {
  return EMAIL.test(value.trim()) ? undefined : "Enter a full email address, like name@example.com.";
}

/** Sign in only needs a password; sign up needs the minimum length. */
export function passwordError(value: string, mode: "sign-in" | "sign-up"): string | undefined {
  if (mode === "sign-in") return value ? undefined : "Enter your password.";
  return value.length >= MIN_PASSWORD ? undefined : `Enter a password of at least ${MIN_PASSWORD} characters.`;
}
