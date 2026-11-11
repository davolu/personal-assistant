import assert from "node:assert/strict";
import { test } from "node:test";
import { isBrief } from "./intent";
import { actionsFromSessionSearch } from "../lib/composio-provider";
import type { CatalogAction } from "./planning";
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

test("session search keeps Composio's primary order and connection status", () => {
  const actions = actionsFromSessionSearch({
    results: [{ primaryToolSlugs: ["NOTION_CREATE_PAGE", "GMAIL_FETCH_EMAILS"], relatedToolSlugs: ["NOTION_SEARCH"] }],
    toolSchemas: {
      NOTION_CREATE_PAGE: { toolkit: "notion", description: "Create a page" },
      GMAIL_FETCH_EMAILS: { toolkit: "gmail", description: "List email messages" },
      NOTION_SEARCH: { toolkit: "notion", description: "Search pages" },
    },
    toolkitConnectionStatuses: [
      { toolkit: "notion", hasActiveConnection: false },
      { toolkit: "gmail", hasActiveConnection: true },
    ],
  });
  assert.deepEqual(actions.map((action) => action.slug), ["NOTION_CREATE_PAGE", "GMAIL_FETCH_EMAILS", "NOTION_SEARCH"]);
  assert.equal(actions[0]?.connected, false);
  assert.equal(actions[1]?.connected, true);
});

test("a later propose can use catalog actions saved on the planning state", async () => {
  const store = new MemoryStore();
  const hub = new ToolHub([createBuiltinProvider(store, NOW)], 1000);
  const firstModel = new ScriptedModel(() => json({ action: "search", toolkits: ["zorblio"], capabilities: ["generate a video"], reasoning: "Look up the video app." }));
  const first = await runTurn(baseTurn({ text: "Make a video with zorblio", catalogActions: ZORBLIO }), { model: firstModel, hub, store, now: NOW });
  assert.equal(first.planning?.candidates?.some((action) => action.slug === "ZORBLIO_GENERATE_CLIP"), true);
  const second = await runTurn(
    baseTurn({
      text: "Zorblio",
      catalogActions: [],
      planning: first.planning,
    }),
    {
      model: new ScriptedModel(() =>
        json({ action: "propose", understanding: "Generate a video", steps: [{ goal: "Generate a video", tool: "ZORBLIO_GENERATE_CLIP" }] })
      ),
      hub,
      store,
      now: NOW,
    }
  );
  assert.equal(second.proposal?.mapped?.[0]?.tool, "ZORBLIO_GENERATE_CLIP");
  assert.equal(/couldn't match/i.test(second.reply), false);
});

test("connecting is not executed as the plan", async () => {
  const store = new MemoryStore();
  const hub = new ToolHub([createBuiltinProvider(store, NOW)], 1000);
  let round = 0;
  const model = new ScriptedModel(() => {
    round += 1;
    if (round === 1) return json({ action: "propose", understanding: "Connect", steps: [{ goal: "Connect the account", tool: "builtin.apps.connect" }] });
    return json({
      action: "propose",
      understanding: "Create the page",
      steps: [{ goal: "Create a page", tool: "NOTION_CREATE_PAGE" }],
    });
  });
  const result = await runTurn(
    baseTurn({
      text: "Add this to my notion list",
      catalogActions: [{ slug: "NOTION_CREATE_PAGE", toolkit: "notion", toolkitName: "Notion", description: "Create a page", connected: false, connectUrl: "https://connect.example/notion" }],
    }),
    { model, hub, store, now: NOW }
  );
  assert.equal(result.proposal?.mapped?.[0]?.tool, "NOTION_CREATE_PAGE");
  assert.equal(result.proposal?.mapped?.[0]?.connectUrl, "https://connect.example/notion");
  assert.equal(result.trace.length, 0);
  assert.doesNotMatch(result.reply, /is ready/i);
});

test("a connected read runs that action instead of asking to connect", async () => {
  const store = new MemoryStore();
  const apps = recordingProvider([
    { name: "GMAIL_FETCH_EMAILS", description: "List email messages", inputSchema: {}, effect: "read", provider: "composio" },
  ]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const model = new ScriptedModel((req) => {
    if (req.role === "plan") {
      return json({ action: "propose", understanding: "Show unread email", steps: [{ goal: "List unread emails", tool: "GMAIL_FETCH_EMAILS" }] });
    }
    return json({ done: true, reply: "Here are the unread emails.", calls: [{ tool: "GMAIL_FETCH_EMAILS", args: { query: "is:unread" } }] });
  });
  const result = await runTurn(
    baseTurn({
      text: "Show my unread emails",
      catalogActions: [{ slug: "GMAIL_FETCH_EMAILS", toolkit: "gmail", toolkitName: "Gmail", description: "List email messages", connected: true }],
    }),
    { model, hub, store, now: NOW }
  );
  assert.deepEqual(apps.calls.map((call) => call.name), ["GMAIL_FETCH_EMAILS"]);
  assert.equal(result.trace.some((entry) => entry.tool === "GMAIL_FETCH_EMAILS" && entry.ok), true);
  assert.notEqual(result.approval?.tool, "builtin.apps.connect");
});

test("an ambiguous toolkit name is asked before a plan", async () => {
  const store = new MemoryStore();
  const hub = new ToolHub([createBuiltinProvider(store, NOW)], 1000);
  const catalog: CatalogAction[] = [
    { slug: "CANVA_LIST_DESIGNS", toolkit: "canva", toolkitName: "Canva", description: "List designs" },
    { slug: "CANVAS_LIST_COURSES", toolkit: "canvas", toolkitName: "Canvas LMS", description: "List courses" },
  ];
  const result = await runTurn(baseTurn({ text: "Summarise my canvas work", catalogActions: catalog }), {
    model: new ScriptedModel(() => json({ action: "propose", understanding: "List courses", steps: [{ goal: "List courses", tool: "CANVAS_LIST_COURSES" }] })),
    hub,
    store,
    now: NOW,
  });
  assert.equal(result.proposal, null);
  assert.ok(result.question?.choices.includes("Canva"));
  assert.ok(result.question?.choices.includes("Canvas LMS"));
});

test("an answered question is not asked again", async () => {
  const store = new MemoryStore();
  const boards = {
    name: "TRELLO_GET_MEMBERS_BOARDS",
    description: "List boards for the member",
    inputSchema: {},
    effect: "read" as const,
    provider: "composio" as const,
  };
  const apps = recordingProvider([boards]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const catalog: CatalogAction[] = [
    { slug: "TRELLO_GET_MEMBERS_BOARDS", toolkit: "trello", toolkitName: "Trello", description: "List boards for the member", connected: true },
    { slug: "TRELLO_ADD_CARDS", toolkit: "trello", toolkitName: "Trello", description: "Add cards to a board", connected: true },
  ];
  const first = await runTurn(baseTurn({ text: "Turn tomorrow's calendar events into cards", catalogActions: catalog }), {
    model: new ScriptedModel((req) => {
      if (!req.system.includes("TRELLO_ADD_CARDS")) return json({ action: "search", queries: ["list boards", "add a card"], reasoning: "Need both steps." });
      return json({ action: "ask", prompt: "Which board?", choices: [], reasoning: "Need a board." });
    }),
    hub,
    store,
    now: NOW,
  });
  assert.equal(first.question?.prompt, "Which board?");
  const second = await runTurn(
    baseTurn({ text: "the marketing board", catalogActions: catalog, planning: first.planning }),
    {
      model: new ScriptedModel((req) => {
        if (req.role === "plan") return json({ action: "ask", prompt: "Which Trello board should I use?", choices: ["Board A"], reasoning: "Still need a board." });
        const pinned = req.system.match(/Call (\S+) for this step/)?.[1];
        if (pinned && !req.messages.some((message) => message.content.includes(pinned))) {
          return json({ done: false, reply: "", calls: [{ tool: pinned, args: { name: "the marketing board" } }] });
        }
        return json({ done: true, reply: "Using the marketing board.", calls: [] });
      }),
      hub,
      store,
      now: NOW,
    }
  );
  assert.equal(second.question, null);
  assert.doesNotMatch(second.reply, /Which Trello board/);
  assert.equal(second.trace.some((entry) => entry.tool === "TRELLO_GET_MEMBERS_BOARDS"), true);
});

test("a scheduled saved workflow runs its steps without a propose", async () => {
  const store = new MemoryStore();
  const apps = recordingProvider([
    { name: "TELEGRAM_SEND_MESSAGE", description: "Send a Telegram message", inputSchema: {}, effect: "external", provider: "composio" },
  ]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const steps = [{ toolkit: "telegram", tool: "TELEGRAM_SEND_MESSAGE", goal: "Send the latest clip", args: { chat_id: "42", text: "New clip" }, refresh: [] as string[] }];
  const catalog: CatalogAction[] = [
    { slug: "TELEGRAM_SEND_MESSAGE", toolkit: "telegram", toolkitName: "Telegram", description: "Send a Telegram message", connected: true },
  ];
  const text = `agent-id:agent-1\ntz:America/New_York\nsaved-steps:${JSON.stringify(steps)}\nRun this saved workflow again.`;
  const searchCatalog = async () => catalog;
  const heldModel = new ScriptedModel(() => json({ action: "ask", prompt: "Which chat should I use?", choices: ["General"] }));
  const held = await runTurn(baseTurn({ text, trigger: "schedule", preapprovedExternal: false }), {
    model: heldModel,
    hub,
    store,
    now: NOW,
    searchCatalog,
  });
  assert.equal(held.stopReason, "WAITING_APPROVAL");
  assert.equal(held.question, null);
  assert.equal(held.approval?.tool, "TELEGRAM_SEND_MESSAGE");
  assert.deepEqual(held.approval?.args.chat_id, "42");
  assert.equal(apps.calls.length, 0);
  assert.equal(heldModel.seen.some((req) => req.role === "plan"), false);

  const approvedModel = new ScriptedModel(() => json({ action: "ask", prompt: "Which chat should I use?", choices: ["General"] }));
  const ran = await runTurn(baseTurn({ text, trigger: "schedule", preapprovedExternal: true }), {
    model: approvedModel,
    hub,
    store,
    now: NOW,
    searchCatalog,
  });
  assert.equal(ran.question, null);
  assert.equal(ran.stopReason, "MODEL_ANSWER");
  assert.equal(apps.calls.some((call) => call.name === "TELEGRAM_SEND_MESSAGE" && call.args.text === "New clip"), true);
  assert.equal(approvedModel.seen.some((req) => req.role === "plan"), false);

  const refresh = [{ toolkit: "telegram", tool: "TELEGRAM_SEND_MESSAGE", goal: "Send the latest clip", args: { chat_id: "42" }, refresh: ["text"] }];
  const stuck = new ScriptedModel(() => "Which video should I send?");
  const failed = await runTurn(
    baseTurn({ text: `saved-steps:${JSON.stringify(refresh)}\nRun this saved workflow again.`, trigger: "schedule", preapprovedExternal: true }),
    { model: stuck, hub, store, now: NOW, searchCatalog }
  );
  assert.equal(failed.stopReason, "FAILED");
  assert.equal(failed.question, null);
  assert.equal(failed.approval, null);
  assert.match(failed.reply, /needs attention/i);
  assert.equal(stuck.seen.some((req) => req.role === "plan"), false);
});

test("a scheduled run that never proposes does not ask a question", async () => {
  const store = new MemoryStore();
  const hub = new ToolHub([createBuiltinProvider(store, NOW)], 1000);
  const result = await runTurn(baseTurn({ text: "Send the clip", trigger: "schedule" }), {
    model: new ScriptedModel(() => json({ action: "ask", prompt: "Which chat?", choices: ["General"], reasoning: "Need a chat." })),
    hub,
    store,
    now: NOW,
  });
  assert.equal(result.stopReason, "FAILED");
  assert.equal(result.question, null);
  assert.equal(result.approval, null);
  assert.match(result.reply, /needs attention/i);
});

test("a scheduled send without save-time approval waits for approval", async () => {
  const store = new MemoryStore();
  const hub = new ToolHub([createBuiltinProvider(store, NOW)], 1000);
  const catalog: CatalogAction[] = [
    { slug: "GMAIL_SEND_EMAIL", toolkit: "gmail", toolkitName: "Gmail", description: "Send an email", connected: true },
  ];
  const result = await runTurn(baseTurn({ text: "Send the digest", trigger: "schedule", catalogActions: catalog }), {
    model: new ScriptedModel((req) => {
      if (req.role !== "plan") return json({ done: false, reply: "", calls: [{ tool: "GMAIL_SEND_EMAIL", args: { body: "Digest" } }] });
      if (!req.system.includes("GMAIL_SEND_EMAIL")) return json({ action: "search", queries: ["send an email"], reasoning: "Need the send action." });
      return json({ action: "propose", understanding: "Send the digest", steps: [{ goal: "Send the digest", tool: "GMAIL_SEND_EMAIL" }] });
    }),
    hub,
    store,
    now: NOW,
  });
  assert.equal(result.stopReason, "WAITING_APPROVAL");
  assert.equal(result.approval?.tool, "GMAIL_SEND_EMAIL");
});

test("search rounds end on the real hits instead of a canned question", async () => {
  const store = new MemoryStore();
  const hub = new ToolHub([createBuiltinProvider(store, NOW)], 1000);
  const result = await runTurn(baseTurn({ text: "Make a clip", catalogActions: ZORBLIO }), {
    model: new ScriptedModel(() => json({ action: "search", queries: ["generate a video"], reasoning: "Look again." })),
    hub,
    store,
    now: NOW,
  });
  assert.equal(/I found these in the catalog/i.test(result.reply), false);
  assert.ok(result.question?.choices.includes("Zorblio"));
  assert.match(result.reply, /ZORBLIO_GENERATE_CLIP|Generate a short video/);
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
