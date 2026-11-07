import { prisma } from "@/lib/prisma";

const BASE = "https://backend.composio.dev/api/v3";

function headers() {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error("COMPOSIO_API_KEY is not set");
  return { "x-api-key": key, "Content-Type": "application/json" };
}

/** Get (or create and cache) a Composio-managed auth config for a toolkit. */
export async function ensureAuthConfig(composioSlug: string): Promise<string> {
  const cached = await prisma.authConfig.findUnique({ where: { composioSlug } });
  if (cached) return cached.configId;

  const res = await fetch(`${BASE}/auth_configs`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      toolkit: { slug: composioSlug },
      auth_config: { type: "use_composio_managed_auth" },
    }),
  });
  const json = await res.json();
  const configId: string | undefined = json?.auth_config?.id;
  if (!res.ok || !configId) {
    throw new Error(
      `Composio auth config failed for ${composioSlug}: ${JSON.stringify(json?.error?.message ?? json).slice(0, 200)}`
    );
  }
  await prisma.authConfig.upsert({
    where: { composioSlug },
    update: { configId },
    create: { composioSlug, configId },
  });
  return configId;
}

/** Create a hosted OAuth link for the end user. */
export async function createConnectLink(params: {
  authConfigId: string;
  userId: string;
  callbackUrl: string;
}): Promise<{ redirectUrl: string; connectedAccountId: string }> {
  const res = await fetch(`${BASE}/connected_accounts/link`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      auth_config_id: params.authConfigId,
      user_id: params.userId,
      callback_url: params.callbackUrl,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.redirect_url) {
    throw new Error(
      `Composio link failed: ${JSON.stringify(json?.error?.message ?? json).slice(0, 200)}`
    );
  }
  return { redirectUrl: json.redirect_url, connectedAccountId: json.connected_account_id };
}

/** Check a connected account's status (ACTIVE once OAuth completes). */
export async function getConnectedAccountStatus(id: string): Promise<string> {
  const res = await fetch(`${BASE}/connected_accounts/${encodeURIComponent(id)}`, {
    headers: headers(),
    cache: "no-store",
  });
  const json = await res.json();
  return json?.status ?? json?.connectionStatus ?? "UNKNOWN";
}
