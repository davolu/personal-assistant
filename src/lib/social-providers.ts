/**
 * Social sign-in is driven by this list. A provider is shown and registered
 * only when both of its env vars are set. Google is the only provider.
 */

type Env = Record<string, string | undefined>;

export type SocialProviderId = "google";

export type EnabledSocialProvider = {
  id: SocialProviderId;
  label: string;
};

type SocialProviderConfig = {
  clientId: string;
  clientSecret: string;
};

const SOCIAL_PROVIDERS = [
  {
    id: "google",
    label: "Google",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
  },
] as const satisfies ReadonlyArray<{
  id: SocialProviderId;
  label: string;
  clientIdEnv: string;
  clientSecretEnv: string;
}>;

function envValue(env: Env, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

export function enabledSocialProviders(env: Env = process.env): EnabledSocialProvider[] {
  return SOCIAL_PROVIDERS.filter(
    (provider) => envValue(env, provider.clientIdEnv) && envValue(env, provider.clientSecretEnv),
  ).map((provider) => ({ id: provider.id, label: provider.label }));
}

/** better-auth socialProviders value. Undefined when nothing is configured. */
export function socialProviderOptions(env: Env = process.env): { google: SocialProviderConfig } | undefined {
  const options: Partial<Record<SocialProviderId, SocialProviderConfig>> = {};
  for (const provider of SOCIAL_PROVIDERS) {
    const clientId = envValue(env, provider.clientIdEnv);
    const clientSecret = envValue(env, provider.clientSecretEnv);
    if (!clientId || !clientSecret) continue;
    options[provider.id] = { clientId, clientSecret };
  }
  if (!options.google) return undefined;
  return { google: options.google };
}

export function accountLinkingOptions(env: Env = process.env): {
  enabled: true;
  trustedProviders: SocialProviderId[];
  requireLocalEmailVerified?: false;
} {
  const trustedProviders = enabledSocialProviders(env).map((provider) => provider.id);
  return {
    enabled: true,
    trustedProviders,
    // Password sign-up leaves emailVerified false. Google is trusted and
    // attests the address, so the same verified Google email can link.
    // An unverified password account registered on someone else's address
    // could receive that person's later Google sign-in. No other provider
    // is trusted. A future better-auth release may ignore this flag.
    ...(trustedProviders.length > 0 ? { requireLocalEmailVerified: false as const } : {}),
  };
}

/** Friendly copy for an OAuth callback that lands back on the sign-in page. */
export function socialSignInMessage(code: string | null | undefined): string | null {
  const key = (code ?? "").trim().toLowerCase();
  if (!key) return null;
  if (key === "account_not_linked" || key === "unable_to_link_account") {
    return "That email already has a password. Sign in with it to continue.";
  }
  if (key === "email_does_not_match" || key === "email_not_verified") {
    return "That provider didn't confirm this email address.";
  }
  return "Couldn't finish that sign-in. Try again.";
}
