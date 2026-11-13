"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useSession } from "@/lib/auth-client";
import { capture, hasIdentifiedUser, identifyUser, resetAnalytics, takeAuthIntent } from "@/lib/analytics";
import { posthogBrowserConfig } from "@/lib/posthog-browser";
import { posthogProjectKey, sanitizeAnalyticsUrl } from "@/lib/posthog";

const key = posthogProjectKey();
if (typeof window !== "undefined" && key && !posthog.__loaded) {
  posthog.init(key, posthogBrowserConfig());
}

export function PostHogBoundary({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (key && !posthog.__loaded) posthog.init(key, posthogBrowserConfig());
  }, []);

  return (
    <PostHogProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogIdentity />
      {children}
    </PostHogProvider>
  );
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.toString();

  useEffect(() => {
    if (!pathname) return;
    const raw = `${window.location.origin}${pathname}${query ? `?${query}` : ""}`;
    capture("$pageview", { $current_url: sanitizeAnalyticsUrl(raw) });
  }, [pathname, query]);

  return null;
}

function PostHogIdentity() {
  const { data: session, isPending } = useSession();
  const user = session?.user;

  useEffect(() => {
    if (isPending) return;
    if (!user?.id) {
      if (hasIdentifiedUser()) resetAnalytics();
      return;
    }
    void identifyUser(user.id, { email: user.email, name: user.name }).then(() => {
      const intent = takeAuthIntent();
      if (intent) capture(intent.event, { method: intent.method });
    });
  }, [isPending, user]);

  return null;
}
