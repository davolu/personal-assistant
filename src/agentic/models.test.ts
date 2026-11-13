import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOL_SCHEMAS } from "./tools";
import { CLAUDE_MODEL_ID, defaultModelId, listModels, providerOptionsFor, resolveModel, selectTools } from "./models";

test("availability follows the provider key and never returns the key", () => {
  const secret = "sk-live-do-not-leak";
  const models = listModels({ ANTHROPIC_API_KEY: secret, OPENAI_API_KEY: "  " });
  const claude = models.find((model) => model.id === CLAUDE_MODEL_ID);
  const gpt = models.find((model) => model.id === "gpt-4.1");
  assert.equal(claude?.available, true);
  assert.equal(gpt?.available, false);
  assert.equal(gpt?.env, "OPENAI_API_KEY");
  assert.equal(JSON.stringify(models).includes(secret), false);
  assert.equal(models.some((model) => model.env === "GOOGLE_GENERATIVE_AI_API_KEY"), true);
  assert.equal(models.some((model) => model.env === "XAI_API_KEY"), true);
  assert.equal(models.some((model) => model.env === "MISTRAL_API_KEY"), true);
});

test("the default is Claude when its key is set, otherwise the first available model", () => {
  assert.equal(defaultModelId({ ANTHROPIC_API_KEY: "present", OPENAI_API_KEY: "present" }), CLAUDE_MODEL_ID);
  assert.equal(defaultModelId({ OPENAI_API_KEY: "present" }), "gpt-4.1");
  assert.equal(defaultModelId({}), null);
  assert.equal(defaultModelId({ ANTHROPIC_API_KEY: "present", ANTHROPIC_MODEL: "claude-opus-4-5" }) && listModels({ ANTHROPIC_API_KEY: "present", ANTHROPIC_MODEL: "claude-opus-4-5" }).find((model) => model.id === CLAUDE_MODEL_ID)?.model, "claude-opus-4-5");
});

test("model ids are rejected when unknown or the provider key is missing", () => {
  const missing = resolveModel("gpt-4.1", {});
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /OPENAI_API_KEY/);
  const unknown = resolveModel("not-a-model", { ANTHROPIC_API_KEY: "present" });
  assert.equal(unknown.ok, false);
  const claude = resolveModel(CLAUDE_MODEL_ID, { ANTHROPIC_API_KEY: "present" });
  assert.equal(claude.ok, true);
  const fallback = resolveModel(undefined, { MISTRAL_API_KEY: "present" });
  assert.equal(fallback.ok, true);
  if (fallback.ok) assert.equal(fallback.model.id, "mistral-large");
});

test("desktop use is offered only to Claude and OpenAI computer use", () => {
  const env = { ANTHROPIC_API_KEY: "present", OPENAI_API_KEY: "present", XAI_API_KEY: "present" };
  const claudeTools = selectTools(CLAUDE_MODEL_ID, TOOL_SCHEMAS, env).map((tool) => tool.name);
  const computerTools = selectTools("openai-computer", TOOL_SCHEMAS, env).map((tool) => tool.name);
  const gptTools = selectTools("gpt-4.1", TOOL_SCHEMAS, env).map((tool) => tool.name);
  assert.equal(claudeTools.includes("use_computer"), true);
  assert.equal(computerTools.includes("use_computer"), true);
  assert.equal(gptTools.includes("use_computer"), false);
  assert.equal(gptTools.includes("search_tools"), true);
  assert.equal(selectTools("", TOOL_SCHEMAS, env).some((tool) => tool.name === "use_computer"), true);
  const claude = resolveModel(CLAUDE_MODEL_ID, env);
  const gpt = resolveModel("gpt-4.1", env);
  assert.ok(claude.ok && providerOptionsFor(claude.model)?.anthropic);
  if (claude.ok) {
    const options = providerOptionsFor(claude.model)?.anthropic as { thinking?: { type?: string }; cacheControl?: { type?: string } };
    assert.equal(options.thinking?.type, "between_tools");
    assert.equal(options.cacheControl?.type, "ephemeral");
  }
  assert.equal(gpt.ok && providerOptionsFor(gpt.model), undefined);
});
