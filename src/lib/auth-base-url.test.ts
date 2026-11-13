import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { authBaseURL, relativeCallbackPath } from "./auth-base-url";
import { CANONICAL_AUTH_ORIGIN, trustedAuthHosts } from "./trusted-origins";

type ResolveBaseURL = (
  config: ReturnType<typeof authBaseURL>,
  basePath: string,
  source: Request | undefined,
  loadEnv: boolean,
  trustedProxyHeaders: boolean,
) => string;

async function loadResolver(): Promise<ResolveBaseURL> {
  const file = pathToFileURL(join(process.cwd(), "node_modules/better-auth/dist/utils/url.mjs")).href;
  const mod = (await import(file)) as { resolveBaseURL: ResolveBaseURL };
  return mod.resolveBaseURL;
}

function request(url: string, headers: Record<string, string>) {
  return new Request(url, { headers });
}

test("auth hosts come from the sign-in allowlist and skip a broad vercel wildcard", () => {
  const hosts = trustedAuthHosts({
    BETTER_AUTH_URL: "https://personal-assistant-five-taupe.vercel.app",
    VERCEL_URL: "personal-assistant-abc-davolus-projects.vercel.app",
  });
  assert.ok(hosts.includes("agentdocker.io"));
  assert.ok(hosts.includes("www.agentdocker.io"));
  assert.ok(hosts.includes("personal-assistant-five-taupe.vercel.app"));
  assert.ok(hosts.includes("*-davolus-projects.vercel.app"));
  assert.ok(hosts.includes("localhost:*"));
  assert.equal(hosts.includes("*.vercel.app"), false);
  assert.equal(authBaseURL().fallback, CANONICAL_AUTH_ORIGIN);
});

test("google callback base URL follows the trusted host and falls back to the public site", async () => {
  const resolveBaseURL = await loadResolver();
  const config = authBaseURL({
    BETTER_AUTH_URL: "https://personal-assistant-five-taupe.vercel.app",
    NEXT_PUBLIC_APP_URL: "https://personal-assistant-five-taupe.vercel.app",
  });
  const resolve = (source: Request | undefined) => resolveBaseURL(config, "/api/auth", source, false, true);

  assert.equal(
    resolve(request("https://personal-assistant-five-taupe.vercel.app/api/auth/sign-in/social", {
      host: "personal-assistant-five-taupe.vercel.app",
      "x-forwarded-host": "agentdocker.io",
      "x-forwarded-proto": "https",
    })),
    "https://agentdocker.io/api/auth",
  );
  assert.equal(
    resolve(request("https://personal-assistant-five-taupe.vercel.app/api/auth/callback/google", {
      host: "www.agentdocker.io",
      "x-forwarded-host": "www.agentdocker.io",
      "x-forwarded-proto": "https",
    })),
    "https://www.agentdocker.io/api/auth",
  );
  assert.equal(
    resolve(request("https://personal-assistant-five-taupe.vercel.app/api/auth/callback/google", {
      host: "personal-assistant-five-taupe.vercel.app",
      "x-forwarded-host": "personal-assistant-five-taupe.vercel.app",
      "x-forwarded-proto": "https",
    })),
    "https://personal-assistant-five-taupe.vercel.app/api/auth",
  );
  assert.equal(
    resolve(request("https://personal-assistant-abc-davolus-projects.vercel.app/api/auth/callback/google", {
      host: "personal-assistant-abc-davolus-projects.vercel.app",
      "x-forwarded-proto": "https",
    })),
    "https://personal-assistant-abc-davolus-projects.vercel.app/api/auth",
  );
  assert.equal(
    resolve(request("http://localhost:3000/api/auth/sign-in/social", {
      host: "localhost:3000",
      "x-forwarded-proto": "http",
    })),
    "http://localhost:3000/api/auth",
  );
  assert.equal(
    resolve(request("https://evil.example/api/auth/sign-in/social", {
      host: "evil.example",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    })),
    "https://agentdocker.io/api/auth",
  );
  assert.equal(resolve(undefined), "https://agentdocker.io/api/auth");
});

test("post-login callbacks stay relative", () => {
  assert.equal(relativeCallbackPath(null), "/dashboard");
  assert.equal(relativeCallbackPath("/dashboard"), "/dashboard");
  assert.equal(relativeCallbackPath("/agentic-chat?draft=1"), "/agentic-chat?draft=1");
  assert.equal(relativeCallbackPath("https://personal-assistant-five-taupe.vercel.app/dashboard"), "/dashboard");
  assert.equal(relativeCallbackPath("//evil.example"), "/dashboard");
  assert.equal(relativeCallbackPath("https://agentdocker.io/signin"), "/dashboard");
});
