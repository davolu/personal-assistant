import { prisma } from "@/lib/prisma";
import { getBot } from "@/lib/agents";

const BASE = "https://backend.composio.dev/api/v3";
const headers = () => ({
  "x-api-key": process.env.COMPOSIO_API_KEY || "",
  "Content-Type": "application/json",
});

// Toolkits that can wake an agent in real time, and the Composio trigger that fires.
export const EVENT_TRIGGERS: Record<string, { slug: string; label: string }> = {
  Gmail: { slug: "GMAIL_NEW_GMAIL_MESSAGE", label: "a new email arrives" },
  Slack: { slug: "SLACK_RECEIVE_MESSAGE", label: "a new Slack message arrives" },
  "Google Drive": { slug: "GOOGLEDRIVE_FILE_CREATED_TRIGGER", label: "a new file lands in Drive" },
  Notion: { slug: "NOTION_PAGE_CREATED", label: "a new Notion page is created" },
};

export function toolkitForTriggerSlug(triggerSlug: string): string | null {
  const upper = triggerSlug.toUpperCase();
  for (const [toolkit, t] of Object.entries(EVENT_TRIGGERS)) {
    if (t.slug === upper) return toolkit;
  }
  return null;
}

export async function agentToolkits(agent: { slug: string; userId: string }): Promise<string[]> {
  if (agent.slug.startsWith("custom-")) {
    const custom = await prisma.customAgent.findFirst({
      where: { id: agent.slug.replace(/^custom-/, ""), userId: agent.userId },
      select: { toolkits: true },
    });
    return custom?.toolkits ?? [];
  }
  return getBot(agent.slug)?.toolkits ?? [];
}

export function eventToolkitsOf(toolkits: string[]): string[] {
  return toolkits.filter((t) => EVENT_TRIGGERS[t]);
}

// Upsert Composio trigger instances for every event-capable toolkit the user has
// connected. Returns the toolkits now subscribed. Composio delivers the events to
// the project webhook URL (dashboard → Settings → Webhooks → /api/webhooks/composio).
export async function subscribeEventTriggers(userId: string, toolkits: string[]) {
  const subscribed: string[] = [];
  for (const tk of eventToolkitsOf(toolkits)) {
    const conn = await prisma.connection.findFirst({
      where: { userId, toolkit: tk, status: "active" },
    });
    if (!conn?.composioAccountId) continue;
    const res = await fetch(`${BASE}/trigger_instances/${EVENT_TRIGGERS[tk].slug}/upsert`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        connected_account_id: conn.composioAccountId,
        user_id: userId,
        trigger_config: {},
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Could not enable the ${tk} trigger: ${body.slice(0, 200)}`);
    }
    subscribed.push(tk);
  }
  return subscribed;
}
