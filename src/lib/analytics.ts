import { posthogBrowserConfig } from "@/lib/posthog-browser";
import { posthogProjectKey } from "@/lib/posthog";

export type AnalyticsProps = Record<string, string | number | boolean | null>;
export type AuthEventName = "signed_up" | "signed_in";

const AUTH_INTENT_KEY = "agentdocker.posthog.auth";
const AUTH_INTENT_TTL_MS = 10 * 60 * 1000;

type PostHogClient = typeof import("posthog-js").posthog;

let starting: Promise<PostHogClient | null> | null = null;
let identifiedId: string | null = null;
let generation = 0;

export function capture(event: string, properties?: AnalyticsProps): void {
  const gen = generation;
  void load().then((posthog) => {
    if (!posthog?.__loaded || gen !== generation) return;
    posthog.capture(event, properties);
  });
}

export function identifyUser(id: string, traits: { email?: string | null; name?: string | null }): Promise<void> {
  const distinctId = id.trim();
  if (!distinctId) return Promise.resolve();
  const gen = generation;
  return load().then((posthog) => {
    if (!posthog?.__loaded || gen !== generation) return;
    if (identifiedId === distinctId) return;
    const properties: Record<string, string> = {};
    if (traits.email) properties.email = traits.email;
    if (traits.name) properties.name = traits.name;
    posthog.identify(distinctId, properties);
    if (gen !== generation) return;
    identifiedId = distinctId;
  });
}

export function resetAnalytics(): void {
  generation += 1;
  identifiedId = null;
  void load().then((posthog) => {
    if (!posthog?.__loaded) return;
    posthog.reset();
  });
}

export function hasIdentifiedUser(): boolean {
  return identifiedId !== null;
}

export function rememberAuthIntent(event: AuthEventName, method = "google"): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(AUTH_INTENT_KEY, JSON.stringify({ event, method, at: Date.now() }));
  } catch {
    // Private mode can reject storage. Sign-in still works.
  }
}

export function takeAuthIntent(): { event: AuthEventName; method: string } | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(AUTH_INTENT_KEY);
    sessionStorage.removeItem(AUTH_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { event?: unknown; method?: unknown; at?: unknown };
    if (parsed.event !== "signed_up" && parsed.event !== "signed_in") return null;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > AUTH_INTENT_TTL_MS) return null;
    return { event: parsed.event, method: typeof parsed.method === "string" ? parsed.method : "google" };
  } catch {
    return null;
  }
}

function load(): Promise<PostHogClient | null> {
  const key = posthogProjectKey();
  if (!key || typeof window === "undefined") return Promise.resolve(null);
  if (starting) return starting;
  starting = import("posthog-js")
    .then((mod) => {
      const posthog = mod.posthog;
      if (!posthog.__loaded) posthog.init(key, posthogBrowserConfig());
      return posthog;
    })
    .catch(() => {
      starting = null;
      return null;
    });
  return starting;
}
