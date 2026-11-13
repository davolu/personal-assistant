import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import {
  PASSWORD_RESET_SENT,
  isAllowlistedOrigin,
  isInvalidResetToken,
  originMatchesPattern,
  passwordIssue,
  passwordResetEmailUrl,
} from "./password-reset";
import { trustedAuthOrigins } from "./trusted-origins";

type MatchOrigin = (url: string, pattern: string) => boolean;

async function loadMatcher(): Promise<MatchOrigin> {
  const file = pathToFileURL(join(process.cwd(), "node_modules/better-auth/dist/auth/trusted-origins.mjs")).href;
  const mod = (await import(file)) as { matchesOriginPattern: MatchOrigin };
  return mod.matchesOriginPattern;
}

const env = {
  BETTER_AUTH_URL: "https://agentdocker.io",
  NEXT_PUBLIC_APP_URL: "https://agentdocker.io",
};

test("origin matching agrees with better-auth for the sign-in allowlist", async () => {
  const matches = await loadMatcher();
  const patterns = trustedAuthOrigins(env);
  const samples = [
    "https://agentdocker.io",
    "https://www.agentdocker.io",
    "https://personal-assistant-five-taupe.vercel.app",
    "https://personal-assistant-git-feature-davolus-projects.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://evil.vercel.app",
    "https://agentdocker.io.evil.com",
    "https://evil.example",
    "https://not-davolus-projects.vercel.app.attacker.com",
  ];
  for (const origin of samples) {
    const theirs = patterns.some((pattern) => matches(origin, pattern));
    assert.equal(isAllowlistedOrigin(origin, patterns), theirs, origin);
    for (const pattern of patterns) {
      assert.equal(originMatchesPattern(origin, pattern), matches(origin, pattern), `${origin} vs ${pattern}`);
    }
  }
});

test("reset links stay on the trusted browser origin and ignore a vercel app URL", () => {
  const issued = "https://agentdocker.io/api/auth/reset-password/tok_123?callbackURL=%2Freset-password";

  const www = passwordResetEmailUrl({
    url: issued,
    env,
    request: new Request("https://agentdocker.io/api/auth/request-password-reset", {
      headers: { origin: "https://www.agentdocker.io" },
    }),
  });
  assert.match(www, /^https:\/\/www\.agentdocker\.io\/api\/auth\/reset-password\/tok_123\?/);
  assert.match(www, /tok_123/);

  const previewOrigin = "https://personal-assistant-abc-davolus-projects.vercel.app";
  const preview = passwordResetEmailUrl({
    url: issued,
    env,
    request: new Request("https://agentdocker.io/api/auth/request-password-reset", {
      headers: { origin: previewOrigin },
    }),
  });
  assert.match(preview, new RegExp(`^${previewOrigin.replace(/[.]/g, "\\.")}/api/auth/reset-password/tok_123`));

  const evil = passwordResetEmailUrl({
    url: issued,
    env,
    request: new Request("https://evil.example/api/auth/request-password-reset", {
      headers: { origin: "https://evil.example", referer: "https://evil.example/forgot-password" },
    }),
  });
  assert.match(evil, /^https:\/\/agentdocker\.io\/api\/auth\/reset-password\/tok_123/);
  assert.doesNotMatch(evil, /evil\.example/);

  const vercel = passwordResetEmailUrl({
    url: issued,
    env: { ...env, BETTER_AUTH_URL: "https://personal-assistant-five-taupe.vercel.app" },
    request: new Request("https://personal-assistant-five-taupe.vercel.app/api/auth/request-password-reset", {
      headers: { origin: "https://personal-assistant-five-taupe.vercel.app" },
    }),
  });
  assert.match(vercel, /^https:\/\/personal-assistant-five-taupe\.vercel\.app\/api\/auth\/reset-password\/tok_123/);

  const misconfigured = {
    BETTER_AUTH_URL: "https://personal-assistant-five-taupe.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://personal-assistant-five-taupe.vercel.app",
  };
  const issuedOnVercel = "https://personal-assistant-five-taupe.vercel.app/api/auth/reset-password/tok_123?callbackURL=%2Freset-password";
  const apex = passwordResetEmailUrl({
    url: issuedOnVercel,
    env: misconfigured,
    request: new Request("https://personal-assistant-five-taupe.vercel.app/api/auth/request-password-reset", {
      headers: { origin: "https://agentdocker.io", "x-forwarded-host": "agentdocker.io" },
    }),
  });
  assert.match(apex, /^https:\/\/agentdocker\.io\/api\/auth\/reset-password\/tok_123/);

  const forwardedWww = passwordResetEmailUrl({
    url: issuedOnVercel,
    env: misconfigured,
    request: new Request("https://personal-assistant-five-taupe.vercel.app/api/auth/request-password-reset", {
      headers: { "x-forwarded-host": "www.agentdocker.io" },
    }),
  });
  assert.match(forwardedWww, /^https:\/\/www\.agentdocker\.io\/api\/auth\/reset-password\/tok_123/);

  const fallback = passwordResetEmailUrl({
    url: issuedOnVercel,
    env: misconfigured,
    request: new Request("https://evil.example/api/auth/request-password-reset", {
      headers: { origin: "https://evil.example" },
    }),
  });
  assert.match(fallback, /^https:\/\/agentdocker\.io\/api\/auth\/reset-password\/tok_123/);
  assert.doesNotMatch(fallback, /vercel\.app/);
});

test("password rules match the 8 character minimum and stay enumeration-safe", () => {
  assert.equal(passwordIssue("short", "short"), "Use at least 8 characters.");
  assert.equal(passwordIssue("longenough", "different"), "Those passwords don't match.");
  assert.equal(passwordIssue("longenough", "longenough"), null);
  assert.equal(isInvalidResetToken("Invalid token", null), true);
  assert.equal(isInvalidResetToken(null, "INVALID_TOKEN"), true);
  assert.equal(isInvalidResetToken("Password too short", "PASSWORD_TOO_SHORT"), false);
  assert.match(PASSWORD_RESET_SENT, /If an account exists/);
  assert.doesNotMatch(PASSWORD_RESET_SENT, /no account|does not exist|couldn't find/i);
});
