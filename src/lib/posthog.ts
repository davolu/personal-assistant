/** PostHog hosts, URL redaction, and replay masking. No SDK import. */

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
export const POSTHOG_PROXY_PATH = "/ingest";

/** Classes PostHog session replay already understands: block, and mask text. */
export const REPLAY_MASK_CLASS = "ph-no-capture ph-mask";

export const REPLAY_MASK_SELECTOR = ".ph-mask, [data-ph-mask]";
export const REPLAY_BLOCK_SELECTOR = ".ph-no-capture";

const REDACTED = "[redacted]";

const URL_PROPERTY_KEYS = new Set([
  "$current_url",
  "$pathname",
  "$referrer",
  "$referring_domain",
  "$initial_current_url",
  "$initial_pathname",
  "$initial_referrer",
  "$initial_referring_domain",
]);

const EXACT_SENSITIVE_PARAMS = new Set([
  "token",
  "code",
  "auth",
  "key",
  "secret",
  "password",
  "passwd",
  "jwt",
  "session",
  "credential",
  "authorization",
]);

export type PostHogEndpoints = {
  apiHost: string;
  assetHost: string;
  uiHost: string;
};

export type PostHogRewrite = { source: string; destination: string };

export function posthogProjectKey(): string | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  return key ? key : null;
}

export function posthogEndpoints(configured?: string): PostHogEndpoints {
  const apiHost = normalizeHost(configured) ?? DEFAULT_POSTHOG_HOST;
  const region = cloudRegion(apiHost);
  if (!region) return { apiHost, assetHost: apiHost, uiHost: apiHost };
  return {
    apiHost,
    assetHost: `https://${region}-assets.i.posthog.com`,
    uiHost: `https://${region}.posthog.com`,
  };
}

/** `/ingest` to the ingestion host, and static/array assets to the asset host. */
export function posthogProxyRewrites(configured?: string): PostHogRewrite[] {
  const { apiHost, assetHost } = posthogEndpoints(configured);
  return [
    { source: `${POSTHOG_PROXY_PATH}/static/:path*`, destination: `${assetHost}/static/:path*` },
    { source: `${POSTHOG_PROXY_PATH}/array/:path*`, destination: `${assetHost}/array/:path*` },
    { source: `${POSTHOG_PROXY_PATH}/:path*`, destination: `${apiHost}/:path*` },
  ];
}

export function isSensitiveQueryParam(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/-/g, "_");
  if (!normalized) return false;
  if (EXACT_SENSITIVE_PARAMS.has(normalized)) return true;
  if (normalized.includes("token")) return true;
  if (normalized.includes("secret")) return true;
  if (normalized.includes("password")) return true;
  if (normalized.includes("apikey") || normalized.includes("api_key")) return true;
  if (normalized.endsWith("_key") || normalized.endsWith("_jwt") || normalized.endsWith("_auth")) return true;
  if (normalized.includes("session")) return true;
  return false;
}

/** Drop reset-password tokens and redact token-like query params. Never throws. */
export function sanitizeAnalyticsUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return value;
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
    const url = new URL(value, "https://agentdocker.local");
    url.username = "";
    url.password = "";
    if (isResetPasswordPath(url.pathname)) {
      url.pathname = url.pathname.replace(/(\/reset-password)(?:\/.*)?$/i, "$1");
      url.search = "";
      url.hash = "";
      return absolute ? url.toString() : url.pathname;
    }
    redactSearchParams(url.searchParams);
    url.hash = sanitizeHash(url.hash);
    if (!absolute) {
      const search = url.searchParams.toString();
      return `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
    }
    return url.toString();
  } catch {
    const cut = value.split("#")[0]?.split("?")[0] ?? "";
    return /reset-password/i.test(cut) ? cut.replace(/(\/reset-password)(?:\/.*)?$/i, "$1") : cut;
  }
}

export function sanitizeAnalyticsProperties(properties: Record<string, unknown> | undefined): void {
  if (!properties) return;
  for (const key of Object.keys(properties)) {
    if (key === "$input_value" || key === "$copy_text" || key === "$selected_content") {
      delete properties[key];
      continue;
    }
    const value = properties[key];
    if (typeof value !== "string") continue;
    if (URL_PROPERTY_KEYS.has(key) || /^https?:\/\//i.test(value) || /reset-password/i.test(value) || /[?&#][^=]*(token|secret|password|api[_-]?key)/i.test(value)) {
      properties[key] = sanitizeAnalyticsUrl(value);
    }
  }
}

export type InputMaskInfo = {
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
};

const SECRET_FIELD = /password|passwd|secret|token|api[_-]?key|apikey|credential|private[_-]?key/i;

export function isPasswordInput(info: InputMaskInfo): boolean {
  return (info.type ?? "").toLowerCase() === "password" || /password/i.test(info.autocomplete ?? "");
}

export function isSecretField(info: InputMaskInfo): boolean {
  const hint = [info.name, info.id, info.autocomplete, info.placeholder, info.className, info.ariaLabel].filter(Boolean).join(" ");
  return SECRET_FIELD.test(hint);
}

/** Inputs are masked by default. Passwords and secret fields stay masked even if that default changes. */
export function shouldMaskInput(info: InputMaskInfo): boolean {
  if (isPasswordInput(info) || isSecretField(info)) return true;
  return true;
}

export function maskRecordedInput(text: string, info: InputMaskInfo): string {
  if (!shouldMaskInput(info)) return text;
  return "*".repeat(text.length);
}

export function agentRunTransition(previous: string, next: string): "agent_run_completed" | "agent_run_failed" | null {
  const running = previous === "submitted" || previous === "streaming";
  if (!running) return null;
  if (next === "ready") return "agent_run_completed";
  if (next === "error") return "agent_run_failed";
  return null;
}

function normalizeHost(configured?: string): string | null {
  const raw = configured?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function cloudRegion(apiHost: string): "us" | "eu" | null {
  let host = "";
  try {
    host = new URL(apiHost).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === "eu.i.posthog.com" || host === "eu.posthog.com" || host.startsWith("eu.") || host.startsWith("eu-")) return "eu";
  if (host === "us.i.posthog.com" || host === "us.posthog.com" || host.startsWith("us.") || host.startsWith("us-") || host.endsWith(".posthog.com") || host === "posthog.com") {
    return "us";
  }
  return null;
}

function isResetPasswordPath(pathname: string): boolean {
  return /\/reset-password(?:\/|$)/i.test(pathname);
}

function redactSearchParams(params: URLSearchParams): void {
  for (const name of [...params.keys()]) {
    if (isSensitiveQueryParam(name)) params.set(name, REDACTED);
  }
}

function sanitizeHash(hash: string): string {
  if (!hash || hash === "#") return "";
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!body.includes("=")) {
    return /token|secret|password/i.test(body) ? "" : hash.startsWith("#") ? hash : `#${hash}`;
  }
  const params = new URLSearchParams(body);
  let sensitive = false;
  for (const name of [...params.keys()]) {
    if (!isSensitiveQueryParam(name)) continue;
    params.set(name, REDACTED);
    sensitive = true;
  }
  if (!sensitive) return hash.startsWith("#") ? hash : `#${hash}`;
  const next = params.toString();
  return next ? `#${next}` : "";
}
