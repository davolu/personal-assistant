import { prisma } from "@/lib/prisma";
import { toolkitComposioSlug } from "@/lib/toolkits";
import { ensureAuthConfig, createConnectLink } from "@/lib/composio";

const appUrl = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/** Hosted Composio OAuth link for one toolkit. Does not send, delete, or pay. */
export async function startConnectLink(userId: string, toolkitName: string): Promise<{ url: string; app: string } | { error: string }> {
  const app = toolkitName.trim();
  if (!app) return { error: "Name the app to connect." };
  if (!process.env.COMPOSIO_API_KEY) return { error: "COMPOSIO_API_KEY is not set." };
  try {
    const composioSlug = toolkitComposioSlug(app);
    const authConfigId = await ensureAuthConfig(composioSlug);
    const callback = `${appUrl()}/agentic-chat?connected=${encodeURIComponent(app)}`;
    const link = await createConnectLink({ authConfigId, userId, callbackUrl: callback });
    await prisma.connection.upsert({
      where: { userId_toolkit: { userId, toolkit: app } },
      update: { status: "pending", composioAccountId: link.connectedAccountId, composioSlug },
      create: {
        userId,
        toolkit: app,
        composioSlug,
        status: "pending",
        composioAccountId: link.connectedAccountId,
      },
    });
    return { url: link.redirectUrl, app };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start the connection.";
    return { error: message.slice(0, 200) };
  }
}
