import assert from "node:assert/strict";
import { test } from "node:test";
import { appsMentioned, ensureActionTools, nudgePlan, unconnectedApps } from "./apps";
import { loadCatalogTools, loadConnectedToolkitTools, rankCatalogTools } from "./composio-tools";
import { gateDecision } from "./policy";
import type { ToolSpec } from "./types";

const gmailSend: ToolSpec = {
  name: "GMAIL_SEND_EMAIL",
  description: "Send an email from the connected Gmail account",
  inputSchema: {},
  effect: "external",
  provider: "composio",
};

test("gmail send ranks Gmail tools ahead of other email tools and leaves web search out", async () => {
  const tools = await loadCatalogTools("gmail send email", [], {
    async listRaw(query) {
      if (query.toolkits?.includes("gmail") && !query.search) {
        return [
          { slug: "GMAIL_FETCH_EMAILS", description: "List emails" },
          { slug: "GMAIL_SEND_EMAIL", description: "Send an email" },
          { slug: "GMAIL_CREATE_EMAIL_DRAFT", description: "Create a draft" },
        ];
      }
      if (query.search && !query.toolkits) {
        return [
          { slug: "COMPOSIO_SEARCH_WEB", description: "Search the web" },
          { slug: "CLARIFY_MCP_SEND_EMAIL", description: "Send an email" },
          { slug: "DADATA_RU_CLEAN_EMAIL", description: "Clean an email" },
        ];
      }
      return [];
    },
  });
  assert.equal(tools[0]?.name, "GMAIL_SEND_EMAIL");
  assert.equal(tools[1]?.name, "GMAIL_CREATE_EMAIL_DRAFT");
  assert.equal(tools.some((tool) => tool.name.startsWith("COMPOSIO_") || tool.name.startsWith("CLARIFY_") || tool.name.startsWith("DADATA_")), false);
});

test("zoho crm ranks Zoho tools first", async () => {
  const tools = await loadCatalogTools("zoho crm", [], {
    async listRaw(query) {
      if (query.toolkits?.some((slug) => slug.startsWith("zoho"))) {
        return [
          { slug: "ZOHO_ADD_TAGS_TO_RECORDS", description: "Add tags" },
          { slug: "ZOHO_CONVERT_ZOHO_LEAD", description: "Convert a lead" },
        ];
      }
      if (query.search && !query.toolkits) {
        return [{ slug: "COMPOSIO_SEARCH_WEB", description: "Search the web" }, { slug: "AFFINDA_PARSE", description: "Parse" }];
      }
      return [];
    },
  });
  assert.match(tools[0]?.name ?? "", /^ZOHO_/);
  assert.equal(tools.some((tool) => tool.name.startsWith("COMPOSIO_")), false);
});

test("a connected toolkit outranks a lookalike when the query names no app", async () => {
  const tools = await loadCatalogTools("send email", ["gmail"], {
    async listRaw(query) {
      if (query.toolkits?.includes("gmail")) return [{ slug: "GMAIL_SEND_EMAIL", description: "Send an email" }];
      if (query.search) return [{ slug: "CLARIFY_MCP_SEND_EMAIL", description: "Send an email" }];
      return [];
    },
  });
  assert.equal(tools[0]?.name, "GMAIL_SEND_EMAIL");
});

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

test("an unread email ranks fetch above send and draft", () => {
  const tools = [
    gmailSend,
    { name: "GMAIL_CREATE_EMAIL_DRAFT", description: "Create a draft", inputSchema: {}, effect: "write_internal" as const, provider: "composio" as const },
    { name: "GMAIL_FETCH_EMAILS", description: "List emails", inputSchema: {}, effect: "read" as const, provider: "composio" as const },
  ];
  const ranked = rankCatalogTools("latest unread email", tools, ["gmail"]);
  assert.equal(ranked[0]?.name, "GMAIL_FETCH_EMAILS");
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
