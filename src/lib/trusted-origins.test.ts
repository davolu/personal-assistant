import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeTrustedOrigin, trustedAuthOrigins, VERCEL_PREVIEW_ORIGIN_PATTERN } from "./trusted-origins";

type MatchOrigin = (url: string, pattern: string) => boolean;

async function loadMatcher(): Promise<MatchOrigin> {
  const file = pathToFileURL(join(process.cwd(), "node_modules/better-auth/dist/auth/trusted-origins.mjs")).href;
  const mod = (await import(file)) as { matchesOriginPattern: MatchOrigin };
  return mod.matchesOriginPattern;
}

function allows(origin: string, patterns: readonly string[], matches: MatchOrigin): boolean {
  return patterns.some((pattern) => matches(origin, pattern));
}

test("allowlist covers production, vercel hosts, the team wildcard, localhost, and TRUSTED_ORIGINS", () => {
  const origins = trustedAuthOrigins({
    VERCEL_URL: "personal-assistant-abc123-davolus-projects.vercel.app",
    VERCEL_BRANCH_URL: "personal-assistant-git-feature-davolus-projects.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "personal-assistant-five-taupe.vercel.app",
    BETTER_AUTH_URL: "https://personal-assistant-five-taupe.vercel.app",
    TRUSTED_ORIGINS: " https://staging.example.com, http://192.168.1.20:3000, ,",
  });

  assert.ok(origins.includes("https://agentdocker.io"));
  assert.ok(origins.includes("https://www.agentdocker.io"));
  assert.ok(origins.includes("https://personal-assistant-five-taupe.vercel.app"));
  assert.ok(origins.includes("https://personal-assistant-abc123-davolus-projects.vercel.app"));
  assert.ok(origins.includes("https://personal-assistant-git-feature-davolus-projects.vercel.app"));
  assert.ok(origins.includes(VERCEL_PREVIEW_ORIGIN_PATTERN));
  assert.ok(origins.includes("http://localhost:*"));
  assert.ok(origins.includes("http://127.0.0.1:*"));
  assert.ok(origins.includes("https://staging.example.com"));
  assert.ok(origins.includes("http://192.168.1.20:3000"));
  assert.equal(origins.filter((origin) => origin === "https://personal-assistant-five-taupe.vercel.app").length, 1);
});

test("vercel hosts are accepted with or without a scheme, and blank env stays safe", () => {
  const origins = trustedAuthOrigins({
    VERCEL_URL: "https://personal-assistant-hash-davolus-projects.vercel.app/",
    VERCEL_PROJECT_PRODUCTION_URL: "app.example.com",
  });
  assert.ok(origins.includes("https://personal-assistant-hash-davolus-projects.vercel.app"));
  assert.ok(origins.includes("https://app.example.com"));
  assert.equal(origins.includes("https://*.vercel.app"), false);

  const empty = trustedAuthOrigins({});
  assert.ok(empty.includes("https://agentdocker.io"));
  assert.ok(empty.includes("https://www.agentdocker.io"));
  assert.ok(empty.includes("https://personal-assistant-five-taupe.vercel.app"));
  assert.ok(empty.includes(VERCEL_PREVIEW_ORIGIN_PATTERN));
  assert.ok(empty.includes("http://localhost:*"));
  assert.equal(empty.includes("https://*.vercel.app"), false);
});

test("unsafe TRUSTED_ORIGINS entries are dropped", () => {
  assert.equal(normalizeTrustedOrigin("javascript:alert(1)"), null);
  assert.equal(normalizeTrustedOrigin("https://user:pass@evil.example"), null);
  assert.equal(normalizeTrustedOrigin("https://*"), null);
  assert.equal(normalizeTrustedOrigin("https://*.vercel.app"), null);
  assert.equal(normalizeTrustedOrigin("https://**.vercel.app"), null);
  assert.equal(normalizeTrustedOrigin("*"), null);
  assert.equal(normalizeTrustedOrigin("https://ok.example.com/path"), "https://ok.example.com");

  const origins = trustedAuthOrigins({
    TRUSTED_ORIGINS: "https://*.vercel.app, javascript:alert(1), https://extra.example.com",
  });
  assert.equal(origins.includes("https://*.vercel.app"), false);
  assert.ok(origins.includes("https://extra.example.com"));
});

test("auth uses this allowlist and does not disable origin or CSRF checks", async () => {
  const { auth } = await import("./auth");
  const options: {
    trustedOrigins: string[];
    advanced?: { disableOriginCheck?: boolean; disableCSRFCheck?: boolean; trustedProxyHeaders?: boolean };
  } = auth.options;
  assert.deepEqual(options.trustedOrigins, trustedAuthOrigins());
  assert.notEqual(options.advanced?.disableOriginCheck, true);
  assert.notEqual(options.advanced?.disableCSRFCheck, true);
});

test("better-auth accepts this project's preview and production origins and rejects others", async () => {
  const matches = await loadMatcher();
  const patterns = trustedAuthOrigins({
    VERCEL_URL: "personal-assistant-9f3c-davolus-projects.vercel.app",
    VERCEL_BRANCH_URL: "personal-assistant-git-main-davolus-projects.vercel.app",
    VERCEL_PROJECT_PRODUCTION_URL: "personal-assistant-five-taupe.vercel.app",
    TRUSTED_ORIGINS: "https://desktop.example.com",
  });

  const trusted = [
    "https://agentdocker.io",
    "https://www.agentdocker.io",
    "https://personal-assistant-five-taupe.vercel.app",
    "https://personal-assistant-git-feature-branch-davolus-projects.vercel.app",
    "https://personal-assistant-abc123-davolus-projects.vercel.app",
    "https://personal-assistant-git-main-davolus-projects.vercel.app/signin",
    "https://personal-assistant-9f3c-davolus-projects.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost",
    "http://[::1]:3000",
    "https://desktop.example.com",
  ];
  for (const origin of trusted) {
    assert.equal(allows(origin, patterns, matches), true, origin);
  }

  const rejected = [
    "https://evil.vercel.app",
    "https://agentdocker.io.evil.com",
    "https://evil.agentdocker.io",
    "https://www.agentdocker.io.evil.com",
    "https://personal-assistant.vercel.app",
    "https://personal-assistant-five-taupe.vercel.app.evil.com",
    "https://not-davolus-projects.vercel.app.attacker.com",
    "http://personal-assistant-git-x-davolus-projects.vercel.app",
    "http://localhost.evil.com",
    "http://localhost.evil.com:3000",
    "https://evil.example",
    "https://preview-other-team.vercel.app",
  ];
  for (const origin of rejected) {
    assert.equal(allows(origin, patterns, matches), false, origin);
  }
});
