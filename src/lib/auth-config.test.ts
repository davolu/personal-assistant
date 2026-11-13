import assert from "node:assert/strict";
import { test } from "node:test";
import { auth, enabledSocialProviders, passwordResetEnabled } from "./auth";
import { authBaseURL } from "./auth-base-url";
import { accountLinkingOptions } from "./social-providers";
import { PASSWORD_RESET_TOKEN_SECONDS } from "./password-reset";
import { mailerConfigured } from "./email";
import { CANONICAL_AUTH_ORIGIN } from "./trusted-origins";

test("auth keeps email sign-in and adds reset plus google linking from env", () => {
  const options = auth.options;
  assert.equal(options.emailAndPassword?.enabled, true);
  assert.equal(options.emailAndPassword?.minPasswordLength, 8);
  assert.equal(options.emailAndPassword?.requireEmailVerification, false);
  assert.equal(options.emailAndPassword?.autoSignIn, true);
  assert.equal(options.emailAndPassword?.resetPasswordTokenExpiresIn, PASSWORD_RESET_TOKEN_SECONDS);
  assert.equal(options.emailAndPassword?.revokeSessionsOnPasswordReset, true);
  assert.equal(Boolean(options.emailAndPassword?.sendResetPassword), passwordResetEnabled);
  assert.equal(passwordResetEnabled, mailerConfigured());
  assert.deepEqual(options.account?.accountLinking, accountLinkingOptions());
  assert.deepEqual(
    enabledSocialProviders.map((provider) => provider.id),
    accountLinkingOptions().trustedProviders,
  );
  assert.ok(enabledSocialProviders.every((provider) => provider.id === "google"));
  assert.deepEqual(options.baseURL, authBaseURL());
  assert.equal(options.advanced?.trustedProxyHeaders, true);
  if (options.baseURL && typeof options.baseURL === "object") {
    assert.equal(options.baseURL.fallback, CANONICAL_AUTH_ORIGIN);
    assert.equal(options.baseURL.allowedHosts.includes("*.vercel.app"), false);
  }
});
