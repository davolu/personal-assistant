import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRequest, isBrief, needsCapabilityPlan, SAMPLE_VIDEO_BRIEF } from "./intent";
import { advancePlanning, rankActions, type CatalogAction } from "./planning";
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

test("a pasted brief is not a clear action, and a send is", () => {
  assert.equal(isBrief(SAMPLE_VIDEO_BRIEF), true);
  assert.equal(classifyRequest(SAMPLE_VIDEO_BRIEF), "brief");
  assert.equal(classifyRequest("send this email to my gmail saying hello"), "clear_action");
  assert.equal(classifyRequest("latest unread email"), "clear_action");
  assert.equal(needsCapabilityPlan("Make me a 5 minute animated video with characters about my product"), true);
  assert.equal(classifyRequest("Make me a 5 minute animated video with characters about my product"), "needs_clarification");
  assert.equal(classifyRequest("help me figure something out"), "needs_clarification");
  assert.equal(classifyRequest("hello"), "clear_action");
});

const VIDEO_CATALOG: CatalogAction[] = [
  { slug: "HEYGEN_CREATE_VIDEO", description: "Create an avatar video from a script" },
  { slug: "ELEVENLABS_TEXT_TO_SPEECH", description: "Generate a voiceover" },
  { slug: "YOUTUBE_UPLOAD_VIDEO", description: "Upload a video" },
  { slug: "GOOGLEDRIVE_UPLOAD_FILE", description: "Upload a file" },
];

test("a video brief asks one catalog question and does not call tools", async () => {
  const store = new MemoryStore();
  const apps = recordingProvider([search]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const model = new ScriptedModel(() => json({ done: false, reply: "", calls: [{ tool: "builtin.web.search", args: { query: "video tools" } }] }));
  const result = await runTurn(baseTurn({ text: SAMPLE_VIDEO_BRIEF, catalogActions: VIDEO_CATALOG, connections: [{ toolkit: "Gmail", status: "active", scopes: "" }] }), {
    model,
    hub,
    store,
    now: NOW,
  });
  assert.deepEqual(apps.calls, []);
  assert.equal(result.trace.length, 0);
  assert.equal(model.seen.length, 0);
  assert.equal(result.proposal, null);
  assert.ok(result.question);
  assert.equal((result.question?.prompt.match(/\?/g) ?? []).length, 1);
  assert.match(result.reply, /HeyGen can make an avatar video/);
  assert.doesNotMatch(result.reply, /Proposed plan:/);
  assert.equal(result.builderHref?.startsWith("/create?idea="), true);
  assert.doesNotMatch(result.reply, /\/create\?idea=/);
});

test("required answers come before a mapped plan, and skip does not skip a required slot", () => {
  const first = advancePlanning({ brief: SAMPLE_VIDEO_BRIEF, text: SAMPLE_VIDEO_BRIEF, state: null, catalog: VIDEO_CATALOG, connections: [] });
  assert.equal(first.proposal, null);
  assert.equal(first.question?.required, true);
  const skipped = advancePlanning({ brief: SAMPLE_VIDEO_BRIEF, text: "Skip", state: first.state, catalog: VIDEO_CATALOG, connections: [] });
  assert.equal(skipped.proposal, null);
  assert.equal(skipped.question?.id, "path");
  const chosen = advancePlanning({
    brief: SAMPLE_VIDEO_BRIEF,
    text: "HeyGen avatar and ElevenLabs voice",
    state: first.state,
    catalog: VIDEO_CATALOG,
    connections: [{ toolkit: "HeyGen", status: "active" }],
  });
  assert.equal(chosen.proposal, null);
  assert.equal(chosen.question?.id, "destination");
  const ready = advancePlanning({ brief: SAMPLE_VIDEO_BRIEF, text: "YouTube", state: chosen.state, catalog: VIDEO_CATALOG, connections: [{ toolkit: "HeyGen", status: "active" }] });
  const tools = ready.proposal?.mapped?.map((step) => step.tool) ?? [];
  assert.deepEqual(tools, ["HEYGEN_CREATE_VIDEO", "ELEVENLABS_TEXT_TO_SPEECH", "YOUTUBE_UPLOAD_VIDEO"]);
  assert.equal(ready.proposal?.mapped?.[0]?.connected, true);
  assert.equal(ready.proposal?.mapped?.[1]?.connected, false);
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

test("canvas to notion asks which app when both exist, then plans without web search", async () => {
  const catalog: CatalogAction[] = [
    { slug: "CANVA_LIST_DESIGNS", description: "List Canva designs" },
    { slug: "CANVAS_LIST_COURSES", description: "List Canvas LMS courses" },
    { slug: "NOTION_CREATE_PAGE", description: "Create a Notion page" },
  ];
  const store = new MemoryStore();
  const apps = recordingProvider([search]);
  const hub = new ToolHub([createBuiltinProvider(store, NOW), apps.provider], 1000);
  const model = new ScriptedModel(() => json({ done: false, reply: "", calls: [{ tool: "builtin.web.search", args: { query: "canva tools" } }] }));
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

test("a short video request is planned from the best generate actions, not status lookups", async () => {
  const catalog: CatalogAction[] = [
    { slug: "HEYGEN_RETRIEVE_VIDEO_STATUS_DETAILS", description: "Retrieve video status details" },
    { slug: "HEYGEN_V2_TEMPLATE_GENERATE", description: "Generate a video from a template" },
    { slug: "ELEVENLABS_ADD_PROJECT", description: "Add a project" },
    { slug: "ELEVENLABS_TEXT_TO_SPEECH", description: "Convert text to speech" },
  ];
  assert.equal(rankActions(catalog, "heygen", "create")?.slug, "HEYGEN_V2_TEMPLATE_GENERATE");
  assert.equal(rankActions(catalog, "elevenlabs", "voice")?.slug, "ELEVENLABS_TEXT_TO_SPEECH");
  const store = new MemoryStore();
  const hub = new ToolHub([createBuiltinProvider(store, NOW)], 1000);
  const model = new ScriptedModel(() => json({ done: false, reply: "", calls: [{ tool: "builtin.web.search", args: { query: "video tools" } }] }));
  const first = await runTurn(
    baseTurn({ text: "Make me a 5 minute animated video with characters about my product", catalogActions: catalog }),
    { model, hub, store, now: NOW }
  );
  assert.equal(first.trace.length, 0);
  assert.equal(first.proposal, null);
  assert.match(first.question?.choices[0] ?? "", /HeyGen avatar and ElevenLabs voice/);
  const ready = advancePlanning({
    brief: first.planning?.brief ?? "",
    text: "HeyGen avatar and ElevenLabs voice",
    state: first.planning,
    catalog,
    connections: [],
  });
  assert.deepEqual(ready.proposal?.mapped?.map((step) => step.tool), ["HEYGEN_V2_TEMPLATE_GENERATE", "ELEVENLABS_TEXT_TO_SPEECH"]);
});

test("tool results are clipped before they can flood the next model call", () => {
  const clipped = clampText("x".repeat(2000), 1200);
  assert.equal(clipped.truncated, true);
  assert.ok(clipped.text.length < 1300);
  assert.match(clipped.text, /truncated/);
});
