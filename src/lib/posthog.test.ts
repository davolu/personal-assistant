import assert from "node:assert/strict";
import { test } from "node:test";
import { capture, identifyUser, resetAnalytics } from "./analytics";
import {
  agentRunTransition,
  isPasswordInput,
  isSecretField,
  isSensitiveQueryParam,
  maskRecordedInput,
  posthogEndpoints,
  posthogProxyRewrites,
  sanitizeAnalyticsProperties,
  sanitizeAnalyticsUrl,
  shouldMaskInput,
} from "./posthog";

test("US is the default host and EU selects the EU asset and UI hosts", () => {
  const us = posthogEndpoints();
  assert.equal(us.apiHost, "https://us.i.posthog.com");
  assert.equal(us.assetHost, "https://us-assets.i.posthog.com");
  assert.equal(us.uiHost, "https://us.posthog.com");

  const eu = posthogEndpoints("https://eu.i.posthog.com/");
  assert.equal(eu.apiHost, "https://eu.i.posthog.com");
  assert.equal(eu.assetHost, "https://eu-assets.i.posthog.com");
  assert.equal(eu.uiHost, "https://eu.posthog.com");
});

test("proxy rewrites send static assets to the asset host before the catch-all", () => {
  const rewrites = posthogProxyRewrites("https://eu.i.posthog.com");
  assert.equal(rewrites[0]?.destination, "https://eu-assets.i.posthog.com/static/:path*");
  assert.equal(rewrites[1]?.destination, "https://eu-assets.i.posthog.com/array/:path*");
  assert.equal(rewrites[2]?.source, "/ingest/:path*");
  assert.equal(rewrites[2]?.destination, "https://eu.i.posthog.com/:path*");
  assert.ok(rewrites.findIndex((rule) => rule.source.includes("/static/")) < rewrites.findIndex((rule) => rule.source === "/ingest/:path*"));
});

test("reset-password URLs and token query params are redacted", () => {
  assert.equal(sanitizeAnalyticsUrl("https://agentdocker.io/reset-password?token=example-token&next=/dashboard"), "https://agentdocker.io/reset-password");
  const pageLink = sanitizeAnalyticsUrl("https://agentdocker.io/reset-password?token=tok_example&next=%2Fdashboard");
  assert.equal(pageLink, "https://agentdocker.io/reset-password");
  assert.equal(pageLink.includes("tok_example"), false);
  const apiLink = sanitizeAnalyticsUrl("https://agentdocker.io/api/auth/reset-password/tok_example?callbackURL=%2Freset-password");
  assert.equal(apiLink.includes("tok_example"), false);
  assert.match(apiLink, /\/api\/auth\/reset-password$/);
  assert.equal(sanitizeAnalyticsUrl("https://agentdocker.io/reset-password/example-token"), "https://agentdocker.io/reset-password");
  assert.equal(sanitizeAnalyticsUrl("/reset-password#token=example-token"), "/reset-password");

  const kept = new URL(sanitizeAnalyticsUrl("https://agentdocker.io/dashboard?token=example-token&tab=runs"));
  assert.equal(kept.searchParams.get("token"), "[redacted]");
  assert.equal(kept.searchParams.get("tab"), "runs");
  assert.equal(kept.searchParams.get("token")?.includes("example-token"), false);

  const code = new URL(sanitizeAnalyticsUrl("https://agentdocker.io/api/auth/callback/google?code=example-code&state=xyz"));
  assert.equal(code.searchParams.get("code"), "[redacted]");
  assert.equal(code.searchParams.get("state"), "xyz");

  assert.equal(sanitizeAnalyticsUrl("https://agentdocker.io/pricing"), "https://agentdocker.io/pricing");
  assert.equal(sanitizeAnalyticsUrl("https://agentdocker.io/signin?next=/dashboard"), "https://agentdocker.io/signin?next=/dashboard");
});

test("token-like parameter names are sensitive and ordinary navigation params are not", () => {
  for (const name of ["token", "access_token", "refresh-token", "api_key", "api-key", "password", "secret", "code"]) {
    assert.equal(isSensitiveQueryParam(name), true, name);
  }
  assert.equal(isSensitiveQueryParam("next"), false);
  assert.equal(isSensitiveQueryParam("plan"), false);
  assert.equal(isSensitiveQueryParam("thread"), false);
});

test("event properties lose reset links and captured input values", () => {
  const properties: Record<string, unknown> = {
    $current_url: "https://agentdocker.io/reset-password?token=example-token",
    $pathname: "/reset-password/example-token",
    $input_value: "a secret prompt",
    plan: "starter",
  };
  sanitizeAnalyticsProperties(properties);
  assert.equal(properties.$current_url, "https://agentdocker.io/reset-password");
  assert.equal(properties.$pathname, "/reset-password");
  assert.equal(properties.$input_value, undefined);
  assert.equal(properties.plan, "starter");
});

test("passwords, secret fields, and every other input are masked", () => {
  assert.equal(isPasswordInput({ type: "password" }), true);
  assert.equal(isSecretField({ name: "api_key", type: "text" }), true);
  assert.equal(isSecretField({ autocomplete: "current-password" }), true);
  assert.equal(shouldMaskInput({ type: "text", name: "search" }), true);
  assert.equal(maskRecordedInput("hunter2", { type: "password" }), "*******");
  assert.equal(maskRecordedInput("sk-example", { name: "apiKey" }), "**********");
});

test("a chat run is completed or failed only after it was in flight", () => {
  assert.equal(agentRunTransition("ready", "ready"), null);
  assert.equal(agentRunTransition("submitted", "streaming"), null);
  assert.equal(agentRunTransition("streaming", "ready"), "agent_run_completed");
  assert.equal(agentRunTransition("submitted", "error"), "agent_run_failed");
});

test("analytics calls do nothing when the project key is missing", async () => {
  assert.equal(process.env.NEXT_PUBLIC_POSTHOG_KEY, undefined);
  await identifyUser("user_1", { email: "person@example.com", name: "Person" });
  capture("signed_in", { method: "email" });
  resetAnalytics();
});
