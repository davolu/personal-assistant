import assert from "node:assert/strict";
import { test } from "node:test";
import { appsMentioned, ensureActionTools, nudgePlan, unconnectedApps } from "./apps";
import { loadConnectedToolkitTools } from "./composio-tools";
import { gateDecision } from "./policy";
import type { ToolSpec } from "./types";

const gmailSend: ToolSpec = {
  name: "GMAIL_SEND_EMAIL",
  description: "Send an email from the connected Gmail account",
  inputSchema: {},
  effect: "external",
  provider: "composio",
};

test("connected toolkit load keeps GMAIL_SEND_EMAIL from the important list", async () => {
  const tools = await loadConnectedToolkitTools(["gmail"], "hello mail", {
    async listRaw(query) {
      if (query.search) return [{ slug: "GMAIL_FETCH_EMAILS", description: "List emails" }];
      return [
        { slug: "GMAIL_SEND_EMAIL", description: "Send an email from Gmail" },
        { slug: "GMAIL_FETCH_EMAILS", description: "List emails" },
      ];
    },
  });
  assert.ok(tools.some((tool) => tool.name === "GMAIL_SEND_EMAIL"));
  assert.equal(gateDecision("GMAIL_SEND_EMAIL").decision, "hold");
});

test("send wording keeps the Gmail send tool when mail does not match email", () => {
  const selected = ensureActionTools("send a hello mail to my gmail", [gmailSend], []);
  assert.deepEqual(selected.map((tool) => tool.name), ["GMAIL_SEND_EMAIL"]);
});

test("zoho matches Zoho toolkits and a hello mail does not", () => {
  const catalog = ["Gmail", "Slack", "Zoho Books", "Zoho CRM", "Zoho Mail"];
  assert.deepEqual(appsMentioned("I want a summary of my zoho", catalog).sort(), ["Zoho Books", "Zoho CRM", "Zoho Mail"]);
  assert.deepEqual(appsMentioned("send a hello mail to my gmail", catalog), ["Gmail"]);
  assert.deepEqual(unconnectedApps("summary of my zoho to my gmail", catalog, ["Gmail"]).sort(), ["Zoho Books", "Zoho CRM", "Zoho Mail"]);
});

test("a chat plan becomes an action when Gmail is connected or Zoho is not", () => {
  const chat = { intent: "chat" as const, success: "answer", steps: [] };
  const send = nudgePlan(chat, {
    text: "send a hello mail to my gmail",
    catalog: ["Gmail", "Zoho Mail"],
    connections: [{ toolkit: "Gmail", status: "active" }],
  });
  assert.equal(send.intent, "act");
  assert.match(send.steps[0]?.toolQuery ?? "", /send email/);
  const zoho = nudgePlan(chat, {
    text: "can you work with zoho",
    catalog: ["Gmail", "Zoho Mail", "Zoho CRM"],
    connections: [{ toolkit: "Gmail", status: "active" }],
  });
  assert.equal(zoho.intent, "act");
  assert.match(zoho.steps[0]?.goal ?? "", /Zoho/);
});
