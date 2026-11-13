/**
 * Origins allowed to call better-auth (sign-in, sign-up, and other state-changing
 * auth requests). This is the CSRF origin allowlist — keep it tight.
 *
 * Trusted:
 * - this project's production URL
 * - the current Vercel deployment, branch, and production hosts
 * - any host under *-davolus-projects.vercel.app (preview and branch URLs)
 * - localhost / loopback
 * - extra origins in TRUSTED_ORIGINS (comma-separated)
 *
 * A wildcard that would trust every *.vercel.app site is ignored.
 */

const PRODUCTION_ORIGINS = ["https://personal-assistant-five-taupe.vercel.app"];

/** Vercel preview, branch, and deployment URLs for the davolus-projects team. */
export const VERCEL_PREVIEW_ORIGIN_PATTERN = "https://*-davolus-projects.vercel.app";

const VERCEL_HOST_VARS = ["VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"] as const;

const LOOPBACK_ORIGINS = [
  "http://localhost",
  "http://localhost:*",
  "https://localhost",
  "https://localhost:*",
  "http://127.0.0.1",
  "http://127.0.0.1:*",
  "https://127.0.0.1",
  "https://127.0.0.1:*",
  "http://[::1]",
  "http://[::1]:*",
  "https://[::1]",
  "https://[::1]:*",
];

const CANONICAL_URL_VARS = ["BETTER_AUTH_URL"] as const;

type Env = Record<string, string | undefined>;

function readEnv(env: Env, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value : "";
}

function isBroadVercelWildcard(origin: string): boolean {
  if (!origin.includes("*") && !origin.includes("?")) return false;
  const host = origin.slice(origin.indexOf("://") + 3);
  if (!host.includes("vercel.app")) return false;
  return !host.includes("davolus-projects.vercel.app");
}

function acceptableAuthority(authority: string): boolean {
  const host = authority.replace(/:\*$/, "").replace(/:\d+$/, "");
  if (!host || host === "*" || host === "**" || host === "*.*" || /^[*?.]+$/.test(host)) return false;
  if (host.startsWith("[")) return /^\[[0-9a-f:*?.]+\]$/.test(host);
  return /^(?:\*+|[a-z0-9*?-]+)(?:\.(?:\*+|[a-z0-9*?-]+))*$/.test(host);
}

/** Returns an http(s) origin or wildcard pattern, or null when the value must not be trusted. */
export function normalizeTrustedOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value || /[\s\u0000-\u001f\u007f\\@]/.test(value)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  if (!/^https?:\/\//i.test(withScheme)) return null;

  if (withScheme.includes("*") || withScheme.includes("?")) {
    const match = withScheme.match(/^(https?):\/\/([^/?#]+)\/?$/i);
    if (!match) return null;
    const scheme = match[1].toLowerCase();
    const authority = match[2].toLowerCase();
    if (!acceptableAuthority(authority)) return null;
    const origin = `${scheme}://${authority}`;
    if (isBroadVercelWildcard(origin)) return null;
    return origin;
  }

  try {
    const url = new URL(withScheme);
    if (url.username || url.password) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function addOrigin(origins: Set<string>, raw: string | undefined) {
  if (!raw) return;
  const origin = normalizeTrustedOrigin(raw);
  if (origin) origins.add(origin);
}

export function trustedAuthOrigins(env: Env = process.env): string[] {
  const origins = new Set<string>();
  for (const origin of PRODUCTION_ORIGINS) addOrigin(origins, origin);
  addOrigin(origins, VERCEL_PREVIEW_ORIGIN_PATTERN);
  for (const origin of LOOPBACK_ORIGINS) addOrigin(origins, origin);

  for (const key of VERCEL_HOST_VARS) addOrigin(origins, readEnv(env, key));
  for (const key of CANONICAL_URL_VARS) addOrigin(origins, readEnv(env, key));

  for (const part of readEnv(env, "TRUSTED_ORIGINS").split(",")) addOrigin(origins, part);

  return [...origins];
}
