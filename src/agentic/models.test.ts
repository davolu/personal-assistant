import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOL_SCHEMAS } from "./tools";
import { PLANS } from "@/lib/site";
import { chooseModel, modelFor } from "./model-choice";
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

test("the default is Sonnet 5.5 when it can be selected, unless AGENTIC_DEFAULT_MODEL names another", () => {
  assert.equal(defaultModelId({ ANTHROPIC_API_KEY: "present", OPENAI_API_KEY: "present" }), CLAUDE_MODEL_ID);
  assert.equal(defaultModelId({ OPENAI_API_KEY: "present" }), "gpt-5-nano");
  assert.equal(defaultModelId({}), null);
  assert.equal(defaultModelId({ ANTHROPIC_API_KEY: "present", AGENTIC_DEFAULT_MODEL: "claude-opus-5-5" }), "claude-opus-5-5");
  assert.equal(defaultModelId({ ANTHROPIC_API_KEY: "present", ANTHROPIC_MODEL: "claude-opus-5-5" }), "claude-opus-5-5");
  const sonnet = listModels({ ANTHROPIC_API_KEY: "present" }).find((model) => model.id === CLAUDE_MODEL_ID);
  assert.equal(sonnet?.model, "claude-sonnet-5-5");
  assert.equal(sonnet?.tier, "premium");
  assert.equal(sonnet?.billable, true);
  assert.equal(defaultModelId({ MISTRAL_API_KEY: "present" }), null);
});

test("Sonnet 5.5 is the default and selectable on free, and another premium model stays locked", () => {
  const env = { ANTHROPIC_API_KEY: "present", OPENAI_API_KEY: "present" };
  assert.equal(PLANS.free.desktop, false);
  assert.deepEqual([...PLANS.free.extraModels], [CLAUDE_MODEL_ID]);
  assert.equal(defaultModelId(env, "free"), CLAUDE_MODEL_ID);
  for (const plan of ["starter", "pro", "scale"] as const) {
    assert.equal(defaultModelId(env, plan), CLAUDE_MODEL_ID);
    assert.deepEqual([...PLANS[plan].extraModels], []);
  }
  const free = listModels(env, "free");
  const sonnet = free.find((model) => model.id === CLAUDE_MODEL_ID);
  assert.equal(sonnet?.available, true);
  assert.equal(sonnet?.locked, false);
  const premium = free.find((model) => model.id === "gpt-5.6");
  assert.equal(premium?.locked, true);
  assert.equal(premium?.available, true);
  const haiku = free.find((model) => model.id === "claude-haiku-5-5");
  assert.equal(haiku?.locked, false);
});

test("without an Anthropic key the default falls back to the cheapest allowed model", () => {
  const env = { OPENAI_API_KEY: "present", AGENTIC_DEFAULT_MODEL: CLAUDE_MODEL_ID };
  assert.equal(defaultModelId(env), "gpt-5-nano");
  assert.equal(defaultModelId(env, "free"), "gpt-5-nano");
  assert.equal(defaultModelId(env, "pro"), "gpt-5-nano");
  const sonnet = listModels(env, "free").find((model) => model.id === CLAUDE_MODEL_ID);
  assert.equal(sonnet?.available, false);
  assert.equal(sonnet?.locked, false);
});

test("a saved model wins over the Sonnet default when the plan allows it", async () => {
  const env = { ANTHROPIC_API_KEY: "present", OPENAI_API_KEY: "present" };
  const userId = "saved-model-user";
  const saved = await chooseModel(userId, null, "claude-haiku-5-5", env, "free");
  assert.equal(saved.ok, true);
  assert.equal(await modelFor(userId, null, env, "free"), "claude-haiku-5-5");
  const sonnet = await chooseModel(userId, null, CLAUDE_MODEL_ID, env, "free");
  assert.equal(sonnet.ok, true);
  assert.equal(await modelFor(userId, null, env, "free"), CLAUDE_MODEL_ID);
  const blocked = await chooseModel(userId, null, "claude-opus-5-5", env, "free");
  assert.equal(blocked.ok, false);
  assert.equal(await modelFor(userId, null, env, "free"), CLAUDE_MODEL_ID);
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
  const selected = resolveModel(undefined, { ANTHROPIC_API_KEY: "present" });
  assert.equal(selected.ok, true);
  if (selected.ok) assert.equal(selected.model.id, CLAUDE_MODEL_ID);
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
