function unwrap(input: unknown): string {
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as { error?: unknown; message?: unknown };
        if (typeof parsed.error === "string") return unwrap(parsed.error);
        if (typeof parsed.message === "string") return unwrap(parsed.message);
        return "";
      } catch {
        return "";
      }
    }
    return trimmed;
  }
  if (input && typeof input === "object" && "error" in input) {
    const error = (input as { error?: unknown }).error;
    if (typeof error === "string") return unwrap(error);
  }
  return "";
}

/** Turn an API payload or thrown message into a sentence. Never returns raw JSON. */
export function readableError(input: unknown, fallback = "Something went wrong. Try again."): string {
  const raw = unwrap(input);
  if (!raw) return fallback;
  if (/^sign in first\.?$/i.test(raw)) return "Sign in to continue.";
  return raw;
}

export function isSignInError(input: unknown): boolean {
  return /sign in/i.test(unwrap(input));
}
