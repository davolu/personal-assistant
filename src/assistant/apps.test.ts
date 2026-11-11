import assert from "node:assert/strict";
import { test } from "node:test";
import { appsMentioned, ensureActionTools, nudgePlan, unconnectedApps } from "./apps";
import { loadCatalogTools } from "./composio-tools";
import type { ToolSpec } from "./types";

test("catalog search keeps Composio's order and drops web search", async () => {
  const tools = await loadCatalogTools("check my latest unread email", [], {
    async listRaw() {
      return [
        { slug: "COMPOSIO_SEARCH_WEB", description: "Search the web" },
        { slug: "GMAIL_FETCH_EMAILS", description: "List email messages" },
        { slug: "GMAIL_SEND_EMAIL", description: "Send an email" },
      ];
    },
  });
  assert.deepEqual(tools.map((tool) => tool.name), ["GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"]);
});

test("the act path does not inject a tool by verb", () => {
  const listed: ToolSpec[] = [
    { name: "GMAIL_SEND_EMAIL", description: "Send an email", inputSchema: {}, effect: "external", provider: "composio" },
  ];
  assert.deepEqual(ensureActionTools("send a hello mail", listed, []), []);
});

test("zoho matches Zoho toolkits and a hello mail does not", () => {
  const catalog = ["Gmail", "Slack", "Zoho Books", "Zoho CRM", "Zoho Mail"];
  assert.deepEqual(appsMentioned("I want a summary of my zoho", catalog).sort(), ["Zoho Books", "Zoho CRM", "Zoho Mail"]);
  assert.deepEqual(appsMentioned("send a hello mail to my gmail", catalog), ["Gmail"]);
  assert.deepEqual(unconnectedApps("summary of my zoho to my gmail", catalog, ["Gmail"]).sort(), ["Zoho Books", "Zoho CRM", "Zoho Mail"]);
});

test("nudge leaves the model's plan unchanged", () => {
  const chat = { intent: "chat" as const, success: "answer", steps: [] };
  const send = nudgePlan(chat, {
    text: "send a hello mail to my gmail",
    catalog: ["Gmail", "Zoho Mail"],
    connections: [{ toolkit: "Gmail", status: "active" }],
  });
  assert.equal(send.intent, "chat");
});
