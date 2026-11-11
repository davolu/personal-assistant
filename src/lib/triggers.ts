import { prisma } from "@/lib/prisma";
import { getBot } from "@/lib/agents";

const BASE = "https://backend.composio.dev/api/v3";
const headers = () => ({
  "x-api-key": process.env.COMPOSIO_API_KEY || "",
  "Content-Type": "application/json",
});

// Toolkits that can wake an agent in real time, and the Composio trigger that fires.
// Only zero-config triggers live here — ones needing a required setting (which repo,
// which board, which channel…) wait for a config picker in the enable flow.
export const EVENT_TRIGGERS: Record<string, { slug: string; label: string }> = {
  Gmail: { slug: "GMAIL_NEW_GMAIL_MESSAGE", label: "a new email arrives" },
  Outlook: { slug: "OUTLOOK_MESSAGE_TRIGGER", label: "a new email arrives" },
  Slack: { slug: "SLACK_RECEIVE_MESSAGE", label: "a new Slack message arrives" },
  "Google Drive": { slug: "GOOGLEDRIVE_FILE_CREATED_TRIGGER", label: "a new file lands in Drive" },
  Notion: { slug: "NOTION_PAGE_CREATED", label: "a new Notion page is created" },
  "Google Calendar": {
    slug: "GOOGLECALENDAR_GOOGLE_CALENDAR_EVENT_CREATED_TRIGGER",
    label: "a new calendar event is created",
  },
  "Google Docs": { slug: "GOOGLEDOCS_DOCUMENT_CREATED_TRIGGER", label: "a new document is created" },
  "Google Sheets": {
    slug: "GOOGLESHEETS_NEW_SPREADSHEET_CREATED_TRIGGER",
    label: "a new spreadsheet is created",
  },
  Confluence: { slug: "CONFLUENCE_NEW_TASK_CREATED_TRIGGER", label: "a new Confluence task is created" },
  Todoist: { slug: "TODOIST_NEW_TASK_CREATED", label: "a new Todoist task is created" },
  Salesforce: { slug: "SALESFORCE_NEW_CONTACT_TRIGGER", label: "a new Salesforce contact is created" },
  Zoom: { slug: "ZOOM_NEW_MEETING_CREATED_TRIGGER", label: "a new Zoom meeting is created" },
  Zendesk: { slug: "ZENDESK_NEW_ZENDESK_TICKET_TRIGGER", label: "a new support ticket arrives" },
  Stripe: { slug: "STRIPE_PAYMENT_INTENT_CREATED", label: "a new Stripe payment is created" },
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

export function eventToolkitsOf(toolkits: string[], triggers: Record<string, { slug: string; label: string }> = EVENT_TRIGGERS): string[] {
  return toolkits.filter((toolkit) => triggers[toolkit]);
}

/** Live trigger types when the API answers. EVENT_TRIGGERS is only the fallback. */
export async function loadEventTriggers(): Promise<Record<string, { slug: string; label: string }>> {
  if (!process.env.COMPOSIO_API_KEY) return EVENT_TRIGGERS;
  try {
    const { Composio } = await import("@composio/core");
    const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
    const page = (await composio.getClient().triggersTypes.list({ limit: 100 } as { limit: number })) as {
      items?: { slug?: string; name?: string; toolkit?: { slug?: string; name?: string } }[];
    };
    const map: Record<string, { slug: string; label: string }> = {};
    for (const item of page.items ?? []) {
      const slug = item.slug;
      const toolkit = item.toolkit?.name || item.toolkit?.slug;
      if (!slug || !toolkit || map[toolkit]) continue;
      map[toolkit] = { slug, label: item.name || toolkit };
    }
    return Object.keys(map).length ? map : EVENT_TRIGGERS;
  } catch {
    return EVENT_TRIGGERS;
  }
}

// Upsert Composio trigger instances for every event-capable toolkit the user has
// connected. Returns the toolkits now subscribed. Composio delivers the events to
// the project webhook URL (dashboard → Settings → Webhooks → /api/webhooks/composio).
export async function subscribeEventTriggers(userId: string, toolkits: string[]) {
  const triggers = await loadEventTriggers();
  const subscribed: string[] = [];
  for (const tk of eventToolkitsOf(toolkits, triggers)) {
    const conn = await prisma.connection.findFirst({
      where: { userId, toolkit: tk, status: "active" },
      select: { composioAccountId: true },
    });
    if (!conn?.composioAccountId) continue;
    const res = await fetch(`${BASE}/trigger_instances/${triggers[tk].slug}/upsert`, {
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
