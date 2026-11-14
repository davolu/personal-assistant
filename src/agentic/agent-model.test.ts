import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentDriver, toAiMessages } from "./agent-model";
import { computerToolResult } from "./computer";
import { CLAUDE_MODEL_ID, selectTools } from "./models";
import { TOOL_SCHEMAS } from "./tools";
import type { AgenticMessage } from "./types";

test("the agent driver uses one AI SDK call and keeps Claude flags off other providers", async () => {
  const calls: { tools: string[]; thinking?: string; cache?: string }[] = [];
  const driver = createAgentDriver({
    env: { ANTHROPIC_API_KEY: "present", OPENAI_API_KEY: "present" },
    languageModel: () => ({ modelId: "fake" }),
    generate: async (options) => {
      const anthropic = options.providerOptions?.anthropic as { thinking?: { type?: string }; cacheControl?: { type?: string } } | undefined;
      calls.push({ tools: Object.keys(options.tools), thinking: anthropic?.thinking?.type, cache: anthropic?.cacheControl?.type });
      return { text: "Done", reasoningText: "Looked it up", toolCalls: [] };
    },
  });
  const env = { ANTHROPIC_API_KEY: "present", OPENAI_API_KEY: "present" };
  const claude = await driver.complete({
    system: "You decide the next step.",
    messages: [{ role: "user", content: "Hello" }],
    tools: selectTools(CLAUDE_MODEL_ID, TOOL_SCHEMAS, env),
    modelId: CLAUDE_MODEL_ID,
  });
  const gpt = await driver.complete({
    system: "You decide the next step.",
    messages: [{ role: "user", content: "Hello" }],
    tools: selectTools("gpt-5.6", TOOL_SCHEMAS, env),
    modelId: "gpt-5.6",
  });
  assert.equal(calls[0]?.thinking, "between_tools");
  assert.equal(calls[0]?.cache, "ephemeral");
  assert.equal(calls[0]?.tools.includes("use_computer"), true);
  assert.equal(calls[1]?.thinking, undefined);
  assert.equal(calls[1]?.tools.includes("use_computer"), false);
  assert.equal(calls[1]?.tools.includes("search_tools"), true);
  assert.match(claude.thinkingSummary, /Looked it up/);
  assert.equal(gpt.content.some((block) => block.type === "text" && block.text === "Done"), true);
  const rejected = await resolveModelMessage();
  assert.equal(rejected.ok, false);
});

async function resolveModelMessage() {
  const { resolveModel } = await import("./models");
  return resolveModel("gpt-4.1", {});
}

const shot = "aW1hZ2U=";

function computerMessages(): AgenticMessage[] {
  return [
    { role: "assistant", content: [{ type: "tool_use", id: "desk-1", name: "use_computer", input: { task: "Open the top story" } }] },
    {
      role: "user",
      content: [
        computerToolResult("desk-1", {
          status: "done",
          summary: "Stopped because the computer step budget was reached. Last action: typed the story URL.",
          screenshot: shot,
          url: "https://news.ycombinator.com/",
          title: "Hacker News — Mozilla Firefox",
        }),
      ],
    },
  ];
}

test("a computer screenshot is an image for vision models and text for the rest", () => {
  const visible = toAiMessages(computerMessages(), false, { vision: true });
  const tool = visible.find((message) => message.role === "tool");
  assert.ok(tool && tool.role === "tool");
  const part = tool.content[0];
  assert.equal(part?.type, "tool-result");
  if (!part || part.type !== "tool-result") return;
  const output = part.output;
  assert.equal(output.type, "content");
  if (output.type !== "content") return;
  const text = output.value.find((item) => item.type === "text");
  const image = output.value.find((item) => item.type === "file");
  assert.equal(text?.type, "text");
  assert.match(text && text.type === "text" ? text.text : "", /computer step budget/);
  assert.match(text && text.type === "text" ? text.text : "", /https:\/\/news\.ycombinator\.com\//);
  assert.match(text && text.type === "text" ? text.text : "", /Hacker News/);
  assert.equal(image?.type, "file");
  if (image?.type === "file") {
    assert.equal(image.mediaType, "image/png");
    assert.equal("type" in image.data && image.data.type, "data");
    if ("type" in image.data && image.data.type === "data") assert.equal(image.data.data, shot);
  }

  const hidden = toAiMessages(computerMessages(), false, { vision: false });
  const hiddenText = JSON.stringify(hidden);
  assert.equal(hiddenText.includes(shot), false);
  assert.match(hiddenText, /Image input is unavailable/);
  assert.match(hiddenText, /https:\/\/news\.ycombinator\.com\//);
  const hiddenTool = hidden.find((message) => message.role === "tool");
  const hiddenPart = hiddenTool && hiddenTool.role === "tool" ? hiddenTool.content[0] : undefined;
  assert.equal(hiddenPart?.type === "tool-result" ? hiddenPart.output.type : "", "text");
});

test("a user message screenshot follows the same vision fallback", () => {
  const messages: AgenticMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: "The desktop run finished." },
        { type: "image", source: { type: "base64", media_type: "image/png", data: shot } },
      ],
    },
  ];
  const visible = toAiMessages(messages, false, { vision: true });
  assert.equal(visible[0]?.role, "user");
  assert.ok(Array.isArray(visible[0]?.content));
  if (visible[0]?.role === "user" && Array.isArray(visible[0].content)) {
    assert.equal(visible[0].content.some((part) => part.type === "file" && part.mediaType === "image/png"), true);
  }
  const hidden = JSON.stringify(toAiMessages(messages, false, { vision: false }));
  assert.equal(hidden.includes(shot), false);
  assert.match(hidden, /Image input is unavailable/);
  assert.match(hidden, /desktop run finished/);
});

test("the agent driver drops a screenshot when the selected model has no vision", async () => {
  const seen: { id?: string; vision: boolean; payload: string }[] = [];
  const driver = createAgentDriver({
    env: { ANTHROPIC_API_KEY: "present", XAI_API_KEY: "present" },
    languageModel: () => ({ modelId: "fake" }),
    generate: async (options) => {
      seen.push({ id: undefined, vision: JSON.stringify(options.messages).includes(shot), payload: JSON.stringify(options.messages) });
      return { text: "ok", toolCalls: [] };
    },
  });
  const messages = computerMessages();
  await driver.complete({ system: "You decide.", messages, tools: [], modelId: CLAUDE_MODEL_ID });
  await driver.complete({ system: "You decide.", messages, tools: [], modelId: "grok-4.20-non-reasoning" });
  assert.equal(seen[0]?.vision, true);
  assert.match(seen[0]?.payload ?? "", /"type":"file"/);
  assert.equal(seen[1]?.vision, false);
  assert.match(seen[1]?.payload ?? "", /Image input is unavailable/);
  assert.equal((seen[1]?.payload ?? "").includes(shot), false);
});
