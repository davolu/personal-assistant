"use client";

import { type ComponentType, type ReactNode } from "react";
import { posthogProjectKey } from "@/lib/posthog";

const key = posthogProjectKey();

// Loaded only when the project key is set, so a missing key never evaluates posthog-js.
const Boundary: ComponentType<{ children: ReactNode }> = key
  ? (require("./posthog-boundary") as typeof import("./posthog-boundary")).PostHogBoundary
  : function PostHogOff({ children }: { children: ReactNode }) {
      return children;
    };

export function PostHogProvider({ children }: { children: ReactNode }) {
  return <Boundary>{children}</Boundary>;
}
