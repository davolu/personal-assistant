import type { NextConfig } from "next";
import { posthogProxyRewrites } from "./src/lib/posthog";

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
    "@e2b/desktop",
    "e2b",
  ],
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
