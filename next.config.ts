import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { posthogProxyRewrites } from "./src/lib/posthog";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Routes that can open the cloud desktop. Their serverless traces must include
 * the ESM loader and the packages it imports at runtime. `@e2b/desktop` and
 * `e2b` stay out of `serverExternalPackages`: that option loads them with
 * Node `require()`, and their CommonJS entry `require()`s ESM-only chalk
 * (`ERR_REQUIRE_ESM` where require-of-ESM is disabled).
 */
const desktopTrace = [
  "./src/agentic/e2b-desktop-loader.mjs",
  "./src/agentic/e2b-resolve-hook.mjs",
  "./node_modules/@e2b/desktop/**/*",
  "./node_modules/e2b/**/*",
  "./node_modules/chalk/**/*",
  "./node_modules/undici/**/*",
  "./node_modules/glob/**/*",
  "./node_modules/tar/**/*",
  "./node_modules/openapi-fetch/**/*",
  "./node_modules/compare-versions/**/*",
  "./node_modules/platform/**/*",
  "./node_modules/@e2b/dockerfile-utils/**/*",
  "./node_modules/@connectrpc/connect/**/*",
  "./node_modules/@connectrpc/connect-web/**/*",
  "./node_modules/@bufbuild/protobuf/**/*",
];

const desktopRoutes = [
  "/api/agentic-chat/route",
  "/api/inngest/route",
  "/api/schedules/route",
  "/api/schedules/goal/route",
  "/api/schedules/[id]/run/route",
];

const nextConfig: NextConfig = {
  // PostHog capture endpoints end in a slash. Redirecting them adds a round trip.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return posthogProxyRewrites(process.env.NEXT_PUBLIC_POSTHOG_HOST);
  },
  async redirects() {
    return [
      { source: "/chat", destination: "/agentic-chat", permanent: false },
      { source: "/chat/:path*", destination: "/agentic-chat", permanent: false },
      { source: "/create", destination: "/agentic-chat", permanent: false },
      { source: "/create/:path*", destination: "/agentic-chat", permanent: false },
      { source: "/agents", destination: "/agentic-chat", permanent: false },
      { source: "/agents/:path*", destination: "/agentic-chat", permanent: false },
      { source: "/hire/:path*", destination: "/agentic-chat", permanent: false },
      { source: "/my-agents", destination: "/schedule", permanent: false },
    ];
  },
  serverExternalPackages: [
    "@langchain/langgraph",
    "@langchain/langgraph-checkpoint-postgres",
    "@langchain/core",
    "pg",
  ],
  outputFileTracingIncludes: Object.fromEntries(desktopRoutes.map((route) => [route, desktopTrace])),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    resolveAlias: {
      "@e2b/desktop": path.join(root, "node_modules/@e2b/desktop/dist/index.mjs"),
      e2b: path.join(root, "node_modules/e2b/dist/index.mjs"),
    },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
