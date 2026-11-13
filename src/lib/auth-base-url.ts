import { CANONICAL_AUTH_ORIGIN, trustedAuthHosts } from "@/lib/trusted-origins";

type Env = Record<string, string | undefined>;

/**
 * Sign-in, sign-up, and password-reset links stay on the trusted host that
 * started the request. A missing or untrusted host falls back to the public site.
 * BETTER_AUTH_URL is not the redirect target.
 */
export function authBaseURL(env: Env = process.env) {
  return {
    allowedHosts: trustedAuthHosts(env),
    fallback: CANONICAL_AUTH_ORIGIN,
    protocol: "auto" as const,
  };
}

/** Keeps post-login and reset redirects on the current host. Absolute URLs are dropped. */
export function relativeCallbackPath(value: string | null | undefined, fallback = "/dashboard"): string {
  const raw = (value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.includes("://")) return fallback;
  return raw;
}
