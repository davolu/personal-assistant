import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOL_SCHEMAS } from "./tools";
import { CLAUDE_MODEL_ID, defaultModelId, listModels, providerOptionsFor, resolveModel, selectTools } from "./models";

test("availability follows the provider key and never returns the key", () => {
  const secret = "sk-live-do-not-leak";
  const models = listModels({ ANTHROPIC_API_KEY: secret, OPENAI_API_KEY: "  " });
  const claude = models.find((model) => model.id === CLAUDE_MODEL_ID);
  const gpt = models.find((model) => model.id === "gpt-5.6");
  assert.equal(claude?.available, true);
  assert.equal(gpt?.available, false);
  assert.equal(gpt?.env, "OPENAI_API_KEY");
  assert.equal(JSON.stringify(models).includes(secret), false);
  assert.ok(models.filter((model) => model.provider === "anthropic").length >= 5);
  assert.ok(models.some((model) => model.model === "claude-opus-5-5"));
  assert.ok(models.some((model) => model.model === "gemini-2.5-flash-lite"));
  assert.ok(models.some((model) => model.model === "mistral-small-latest"));
  assert.ok(models.some((model) => model.model === "deepseek-v4-pro"));
  assert.ok(models.some((model) => model.model === "qwen/qwen3.6-27b"));
});

test("the default is a cheap billable model, unless AGENTIC_DEFAULT_MODEL names another", () => {
  assert.equal(defaultModelId({ ANTHROPIC_API_KEY: "present", OPENAI_API_KEY: "present" }), "claude-haiku-5-5");
  assert.equal(defaultModelId({ OPENAI_API_KEY: "present" }), "gpt-5-nano");
  assert.equal(defaultModelId({}), null);
  assert.equal(defaultModelId({ ANTHROPIC_API_KEY: "present", AGENTIC_DEFAULT_MODEL: "claude-opus-5-5" }), "claude-opus-5-5");
  assert.equal(defaultModelId({ ANTHROPIC_API_KEY: "present", ANTHROPIC_MODEL: "claude-opus-5-5" }), "claude-opus-5-5");
  const sonnet = listModels({ ANTHROPIC_API_KEY: "present" }).find((model) => model.id === CLAUDE_MODEL_ID);
  assert.equal(sonnet?.model, "claude-sonnet-5-5");
  assert.equal(sonnet?.billable, true);
  assert.equal(defaultModelId({ MISTRAL_API_KEY: "present" }), null);
  assert.equal(defaultModelId({ ANTHROPIC_API_KEY: "present" }, "free"), "claude-haiku-5-5");
  const locked = listModels({ ANTHROPIC_API_KEY: "present", OPENAI_API_KEY: "present" }, "free").find((model) => model.id === "gpt-5.6");
  assert.equal(locked?.locked, true);
  assert.equal(locked?.available, true);
});

test("model ids are rejected when unknown or the provider key is missing", () => {
  const missing = resolveModel("gpt-5.6", {});
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.match(missing.error, /OPENAI_API_KEY/);
  const unknown = resolveModel("not-a-model", { ANTHROPIC_API_KEY: "present" });
  assert.equal(unknown.ok, false);
  const claude = resolveModel(CLAUDE_MODEL_ID, { ANTHROPIC_API_KEY: "present" });
  assert.equal(claude.ok, true);
  const fallback = resolveModel(undefined, { MISTRAL_API_KEY: "present" });
  assert.equal(fallback.ok, false);
  const haiku = resolveModel(undefined, { ANTHROPIC_API_KEY: "present" });
  assert.equal(haiku.ok, true);
  if (haiku.ok) assert.equal(haiku.model.id, "claude-haiku-5-5");
});

test("desktop use is offered to Opus, Sonnet, Haiku, and OpenAI computer use", () => {
  const env = { ANTHROPIC_API_KEY: "present", OPENAI_API_KEY: "present" };
  for (const id of ["claude-opus-5-5", "claude-opus-4-8", "claude-sonnet-5-5", "claude-sonnet-4-6", "claude-haiku-5-5", "computer-use-preview"]) {
    assert.equal(selectTools(id, TOOL_SCHEMAS, env).some((tool) => tool.name === "use_computer"), true, id);
  }
  assert.equal(selectTools("gpt-5.6", TOOL_SCHEMAS, env).some((tool) => tool.name === "use_computer"), false);
  assert.equal(selectTools("gpt-5.6", TOOL_SCHEMAS, env).some((tool) => tool.name === "search_tools"), true);
  const claude = resolveModel(CLAUDE_MODEL_ID, env);
  assert.ok(claude.ok);
  if (claude.ok) {
    const options = providerOptionsFor(claude.model)?.anthropic as { thinking?: { type?: string }; cacheControl?: { type?: string } };
    assert.equal(options.thinking?.type, "between_tools");
    assert.equal(options.cacheControl?.type, "ephemeral");
    assert.match(claude.model.hint, /computer/);
  }
});

test("AGENTIC_MODELS adds a custom id and still rejects anything else", () => {
  const env = {
    OPENAI_API_KEY: "present",
    AGENTIC_MODELS: JSON.stringify([
      { id: "my-ft", provider: "openai", label: "Fine-tune", model: "ft:gpt-4.1:acme", hint: "Private" },
      { id: "claude-opus-5-5", provider: "openai", label: "Collision", model: "gpt-5.6" },
      { provider: "openai", label: "Missing id", model: "gpt-5.6" },
    ]),
  };
  const models = listModels(env);
  const custom = models.find((model) => model.id === "my-ft");
  assert.equal(custom?.available, true);
  assert.equal(custom?.model, "ft:gpt-4.1:acme");
  assert.equal(custom?.hint, "Private");
  assert.equal(models.filter((model) => model.id === "claude-opus-5-5").length, 1);
  assert.equal(resolveModel("my-ft", env).ok, true);
  assert.equal(resolveModel("not-listed", env).ok, false);
  assert.equal(listModels({ AGENTIC_MODELS: "not-json" }).some((model) => model.id === "my-ft"), false);
});
