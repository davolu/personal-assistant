import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentDriver } from "./agent-model";
import { CLAUDE_MODEL_ID, selectTools } from "./models";
import { TOOL_SCHEMAS } from "./tools";

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
    tools: selectTools("gpt-4.1", TOOL_SCHEMAS, env),
    modelId: "gpt-4.1",
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
