import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { accountLinkingOptions, enabledSocialProviders, socialProviderOptions, socialSignInMessage } from "./social-providers";

test("only Google is offered, and only when both env vars are set", () => {
  assert.deepEqual(enabledSocialProviders({}), []);
  assert.equal(socialProviderOptions({}), undefined);
  assert.deepEqual(enabledSocialProviders({ GOOGLE_CLIENT_ID: "id" }), []);
  assert.deepEqual(enabledSocialProviders({ GOOGLE_CLIENT_SECRET: "secret" }), []);

  const env = { GOOGLE_CLIENT_ID: " google-id ", GOOGLE_CLIENT_SECRET: " google-secret " };
  assert.deepEqual(enabledSocialProviders(env), [{ id: "google", label: "Google" }]);
  assert.deepEqual(socialProviderOptions(env), {
    google: { clientId: "google-id", clientSecret: "google-secret" },
  });
});

test("account linking trusts the enabled providers and no others", () => {
  assert.deepEqual(accountLinkingOptions({}), { enabled: true, trustedProviders: [] });
  const linked = accountLinkingOptions({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
  assert.deepEqual(linked.trustedProviders, ["google"]);
  assert.equal(linked.requireLocalEmailVerified, false);
  assert.equal(linked.enabled, true);
});

test("the provider catalog and the sign-in buttons do not add other vendors", () => {
  const catalog = readFileSync(new URL("./social-providers.ts", import.meta.url), "utf8");
  const form = readFileSync(new URL("../components/AuthForm.tsx", import.meta.url), "utf8");
  assert.match(form, /providers\.map/);
  assert.match(form, /Continue with \{provider\.label\}/);
  assert.doesNotMatch(catalog, /github|microsoft/i);
  assert.doesNotMatch(form, /github|microsoft/i);
});

test("oauth callback errors become short sign-in copy", () => {
  assert.equal(socialSignInMessage(null), null);
  assert.match(socialSignInMessage("account_not_linked") ?? "", /password/i);
  assert.match(socialSignInMessage("email_not_verified") ?? "", /email/i);
  assert.match(socialSignInMessage("something_else") ?? "", /try again/i);
  assert.doesNotMatch(
    `${socialSignInMessage("account_not_linked")} ${socialSignInMessage("something_else")}`,
    /\b(claude|gpt|gemini|llama|mistral|anthropic|openai)\b/i,
  );
});
