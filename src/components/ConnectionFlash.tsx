"use client";

import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { capture } from "@/lib/analytics";
import { notify } from "@/lib/toast";

/** Toasts the OAuth tab when it lands back on connected= or failed=. */
export default function ConnectionFlash() {
  const params = useSearchParams();
  const connected = params.get("connected");
  const failed = params.get("failed");
  const seen = useRef("");

  useEffect(() => {
    const key = `${connected ?? ""}\n${failed ?? ""}`;
    if (seen.current === key) return;
    seen.current = key;
    const ok = label(connected);
    const bad = label(failed);
    if (ok) {
      notify(`${ok} connected.`, "success");
      capture("app_connected", { app: ok, source: "oauth" });
    }
    if (bad) notify(`${bad} connection didn't complete — try again.`, "error");
  }, [connected, failed]);

  return null;
}

function label(value: string | null): string {
  if (!value) return "";
  return value.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}
