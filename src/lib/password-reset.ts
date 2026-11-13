import { CANONICAL_AUTH_ORIGIN, trustedAuthOrigins } from "@/lib/trusted-origins";

type Env = Record<string, string | undefined>;

export const PASSWORD_RESET_TOKEN_SECONDS = 60 * 60;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/** Same wording for every address, so the response does not reveal who has an account. */
export const PASSWORD_RESET_SENT =
  "If an account exists for that email, we sent a link to reset the password. It expires in one hour.";

export const PASSWORD_RESET_UPDATED = "Password updated. Sign in with your new password.";

export const PASSWORD_RESET_INVALID =
  "This reset link is invalid or has expired. Request a new one and we'll send another.";

type HeaderSource = { get(name: string): string | null };

export function passwordIssue(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  if (password !== confirm) return "Those passwords don't match.";
  return null;
}

export function isInvalidResetToken(message?: string | null, code?: string | null): boolean {
  if ((code ?? "").trim().toUpperCase() === "INVALID_TOKEN") return true;
  return /invalid token|expired/i.test(message ?? "");
}

function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null") return null;
  try {
    const url = new URL(trimmed);
    if (url.username || url.password) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Glob match for the allowlist. `*` does not cross `/`, matching better-auth. */
export function originMatchesPattern(origin: string, pattern: string): boolean {
  if (!pattern.includes("*") && !pattern.includes("?")) return origin === pattern;
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${source}$`).test(origin);
}

export function isAllowlistedOrigin(origin: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => originMatchesPattern(origin, pattern));
}

function replaceUrlOrigin(url: string, origin: string): string {
  const next = new URL(url);
  const base = new URL(origin);
  next.protocol = base.protocol;
  next.host = base.host;
  return next.toString();
}

function originFromForwardedHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const value = host.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!value || value.includes(" ") || value.includes("/")) return null;
  const loopback = value.startsWith("localhost") || value.startsWith("127.") || value.startsWith("[::1]");
  return originOf(`${loopback ? "http" : "https"}://${value}`);
}

/**
 * Prefer the browser's trusted origin. An untrusted host, and a BETTER_AUTH_URL
 * that points at a deployment host, fall back to the public site.
 */
export function passwordResetEmailUrl(input: {
  url: string;
  request?: { url?: string; headers?: HeaderSource } | null;
  env?: Env;
}): string {
  const env = input.env ?? process.env;
  const patterns = trustedAuthOrigins(env);
  const headers = input.request?.headers;
  const candidates = [
    originOf(headers?.get("origin")),
    originFromForwardedHost(headers?.get("x-forwarded-host")),
    originOf(headers?.get("referer")),
    originOf(input.request?.url),
    CANONICAL_AUTH_ORIGIN,
  ];
  const chosen = candidates.find((origin) => origin !== null && isAllowlistedOrigin(origin, patterns));
  if (!chosen) return input.url;
  try {
    return replaceUrlOrigin(input.url, chosen);
  } catch {
    return input.url;
  }
}
