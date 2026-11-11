import assert from "node:assert/strict";
import { test } from "node:test";
import { isBrief } from "./intent";
import { rankActions, type CatalogAction } from "./planning";
import { createBuiltinProvider } from "./builtin";
import { MemoryStore } from "./memory-store";
import { ToolHub } from "./hub";
import { runTurn } from "./orchestrator";
import { baseTurn, json, recordingProvider, ScriptedModel } from "./test-support";
import type { ToolSpec } from "./types";
import { clampText } from "./util";

const NOW = () => new Date("2026-11-11T12:00:00.000Z");

const search: ToolSpec = {
  name: "COMPOSIO_SEARCH_WEB",
  description: "Search the public web",
  inputSchema: {},
  effect: "read",
  provider: "composio",
};

const gmailSend: ToolSpec = {
  name: "GMAIL_SEND_EMAIL",
  description: "Send an email",
  inputSchema: {},
  effect: "external",
  provider: "composio",
};

test("an agent description still offers the builder", () => {
  assert.equal(isBrief(VIDEO_BRIEF), true);
});

const VIDEO_BRIEF =
  "a video agent that can create videos, characters and image from script given it and it will be 3-5 minutes in length and can also edit videos with prompts";

const ZORBLIO: CatalogAction[] = [
  { slug: "ZORBLIO_GENERATE_CLIP", toolkit: "zorblio", toolkitName: "Zorblio", description: "Generate a short video clip from a script" },
  { slug: "ZORBLIO_GET_STATUS", toolkit: "zorblio", toolkitName: "Zorblio", description: "Retrieve render status" },
  { slug: "MURKLE_SPEAK", toolkit: "murkle", toolkitName: "Murkle", description: "Create a voiceover from a script" },
];

test("a made-up catalog app is offered only after the model searches", async () => {
  const store = new MemoryStore();
  const apps = recordingProvider([search]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const model = new ScriptedModel((req) => {
    if (!req.system.includes("ZORBLIO_GENERATE_CLIP")) {
      return json({ action: "search", queries: ["generate video", "voiceover from script"], reasoning: "Need a video and a voice." });
    }
    return json({
      action: "ask",
      prompt: "I can generate a clip with Zorblio and a voiceover with Murkle. Want that?",
      choices: ["Zorblio clip and Murkle voice"],
      required: true,
      reasoning: "Those are the matching tools.",
    });
  });
  const result = await runTurn(baseTurn({ text: "Make me a 5 minute animated video with characters about my product", catalogActions: ZORBLIO }), {
    model,
    hub,
    store,
    now: NOW,
  });
  assert.deepEqual(apps.calls, []);
  assert.equal(result.trace.length, 0);
  assert.equal(result.proposal, null);
  assert.deepEqual(result.question?.choices, ["Zorblio clip and Murkle voice"]);
  assert.equal((result.reply.match(/\?/g) ?? []).length, 1);
});

test("web search stops after two calls instead of looping", async () => {
  const store = new MemoryStore();
  const apps = recordingProvider([search]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  let n = 0;
  const model = new ScriptedModel((req) => {
    if (req.role === "plan") return json({ intent: "act", success: "find grants", steps: [{ id: "s1", goal: "search grants", toolQuery: "latest nonprofit grants" }] });
    n += 1;
    return json({ done: false, reply: "", calls: [{ tool: "builtin.web.search", args: { query: `nonprofit grants ${n}` } }] });
  });
  const result = await runTurn(baseTurn({ text: "search the web for the latest nonprofit grants" }), { model, hub, store, now: NOW });
  const searches = result.trace.filter((entry) => entry.tool.includes("SEARCH") || entry.tool.includes("search"));
  assert.ok(searches.length <= 2);
  assert.equal(searches.length, 2);
  assert.match(result.reply, /already searched the web twice/);
});

test("a clear email request still takes the action path", async () => {
  const store = new MemoryStore();
  const apps = recordingProvider([gmailSend]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const model = new ScriptedModel((req) => {
    if (req.role === "plan") {
      return json({ intent: "act", success: "prepare the email", steps: [{ id: "s1", goal: "send the email", toolQuery: "send email gmail" }] });
    }
    return json({ done: true, reply: "Ready.", calls: [{ tool: "GMAIL_SEND_EMAIL", args: { body: "Hello" } }] });
  });
  const result = await runTurn(
    baseTurn({
      text: "send this email to my gmail saying hello",
      ownerEmail: "owner@example.com",
      connections: [{ toolkit: "Gmail", status: "active", scopes: "" }],
    }),
    { model, hub, store, now: NOW }
  );
  assert.equal(result.stopReason, "WAITING_APPROVAL");
  assert.equal(result.approval?.tool, "GMAIL_SEND_EMAIL");
  assert.equal(result.proposal, null);
  assert.doesNotMatch(result.reply, /Before I use any tools/);
  assert.equal(apps.calls.length, 0);
});

const CANVAS_PROMPT = "Can you summarise all I've done on canvas to my notion list?";

test("two catalog toolkits that share a name are asked about before a plan", async () => {
  const catalog: CatalogAction[] = [
    { slug: "CANVA_LIST_DESIGNS", toolkit: "canva", toolkitName: "Canva", description: "List designs" },
    { slug: "CANVAS_LIST_COURSES", toolkit: "canvas", toolkitName: "Canvas LMS", description: "List courses" },
    { slug: "NOTION_CREATE_PAGE", toolkit: "notion", toolkitName: "Notion", description: "Create a page" },
  ];
  const store = new MemoryStore();
  const apps = recordingProvider([search]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const model = new ScriptedModel((req) => {
    if (!req.system.includes("CANVA_LIST_DESIGNS")) {
      return json({ action: "search", queries: ["canvas", "create page"], reasoning: "The name matches more than one toolkit." });
    }
    if (!req.messages.some((message) => message.content === "Canva")) {
      return json({
        action: "ask",
        prompt: "Did you mean Canva designs, or Canvas LMS?",
        choices: ["Canva", "Canvas LMS"],
        required: true,
        reasoning: "Both toolkits are in the catalog results.",
      });
    }
    return json({
      action: "propose",
      understanding: "List the designs and add a page.",
      steps: [
        { goal: "List designs", tool: "CANVA_LIST_DESIGNS" },
        { goal: "Add the summary to the list", tool: "NOTION_CREATE_PAGE" },
      ],
      reasoning: "The user picked the design toolkit.",
    });
  });
  const deps = { model, hub, store, now: NOW, connectApp: async (_userId: string, app: string) => ({ url: `https://connect.example/${app}`, app }) };
  const first = await runTurn(baseTurn({ text: CANVAS_PROMPT, catalogActions: catalog, connections: [] }), deps);
  assert.equal(first.trace.length, 0);
  assert.deepEqual(apps.calls, []);
  assert.equal(first.proposal, null);
  assert.equal(first.question?.prompt, "Did you mean Canva designs, or Canvas LMS?");
  assert.deepEqual(first.question?.choices, ["Canva", "Canvas LMS"]);
  const second = await runTurn(
    baseTurn({ text: "Canva", catalogActions: catalog, connections: [], planning: first.planning }),
    deps
  );
  assert.equal(second.trace.length, 0);
  assert.deepEqual(apps.calls, []);
  const tools = second.proposal?.mapped?.map((step) => step.tool);
  assert.deepEqual(tools, ["CANVA_LIST_DESIGNS", "NOTION_CREATE_PAGE"]);
  assert.equal(second.proposal?.mapped?.every((step) => step.connected === false), true);
  assert.match(second.proposal?.mapped?.[0]?.connectUrl ?? "", /connect\.example\/Canva/);
  assert.doesNotMatch(second.reply, /web search/i);
});

test("rankActions prefers a generate description over a status lookup", () => {
  const catalog: CatalogAction[] = [
    { slug: "ZORBLIO_GET_STATUS", toolkit: "zorblio", description: "Retrieve render status details" },
    { slug: "ZORBLIO_GENERATE_CLIP", toolkit: "zorblio", description: "Generate a video clip from a script" },
    { slug: "MURKLE_CONVERT_VOICE", toolkit: "murkle", description: "Convert an existing voice recording" },
    { slug: "MURKLE_SPEAK", toolkit: "murkle", description: "Create a voiceover from a script" },
  ];
  assert.equal(rankActions(catalog, "zorblio", "generate a video from a script")?.slug, "ZORBLIO_GENERATE_CLIP");
  assert.equal(rankActions(catalog, "murkle", "voiceover from script")?.slug, "MURKLE_SPEAK");
});

test("make a video does not rank a comment reply", () => {
  const catalog: CatalogAction[] = [
    { slug: "ZORBLIO_CREATE_COMMENT_REPLY", toolkit: "zorblio", description: "Create a reply to a comment" },
    { slug: "ZORBLIO_CREATE_MEET", toolkit: "zorblio", description: "Create a meeting" },
    { slug: "ZORBLIO_GENERATE_CLIP", toolkit: "zorblio", description: "Generate a video clip from a script" },
  ];
  assert.equal(rankActions(catalog, "zorblio", "make a video")?.slug, "ZORBLIO_GENERATE_CLIP");
});

test("a fetch that needs an id loses to a list the user can run now", () => {
  const catalog: CatalogAction[] = [
    { slug: "MAILBOX_FETCH_MESSAGE_BY_MESSAGE_ID", toolkit: "mailbox", description: "Fetch one message by id", required: ["message_id"] },
    { slug: "MAILBOX_FETCH_EMAILS", toolkit: "mailbox", description: "List emails in the inbox" },
  ];
  assert.equal(rankActions(catalog, "mailbox", "check my latest unread email")?.slug, "MAILBOX_FETCH_EMAILS");
});

test("catalog hits are not thrown away when the model returns invalid JSON", async () => {
  const store = new MemoryStore();
  const hub = new ToolHub([createBuiltinProvider(store, NOW)], 1000);
  const model = new ScriptedModel(() => "not json");
  const result = await runTurn(
    baseTurn({
      text: "Make me a 5 minute animated video with characters about my product",
      catalogActions: ZORBLIO,
    }),
    { model, hub, store, now: NOW }
  );
  assert.equal(/couldn't match/i.test(result.reply), false);
  assert.ok(result.question?.choices.includes("Zorblio"));
});

test("tool results are clipped before they can flood the next model call", () => {
  const clipped = clampText("x".repeat(2000), 1200);
  assert.equal(clipped.truncated, true);
  assert.ok(clipped.text.length < 1300);
  assert.match(clipped.text, /truncated/);
});
