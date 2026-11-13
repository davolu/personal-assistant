"use client";

import { sameApp } from "@/lib/connect-url";

type WatchOptions = {
  app?: string;
  onConnected: (app: string) => void;
  intervalMs?: number;
  timeoutMs?: number;
};

/** Poll, and also check when the tab regains focus, until the named app is connected. */
export function watchConnection(options: WatchOptions): () => void {
  const intervalMs = options.intervalMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 3 * 60 * 1000;
  let stopped = false;
  let baseline = new Set<string>();
  let primed = false;
  const started = Date.now();

  async function check() {
    if (stopped || Date.now() - started > timeoutMs) return stop();
    const query = options.app ? `?app=${encodeURIComponent(options.app)}` : "";
    const res = await fetch(`/api/connections/status${query}`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const json = (await res.json()) as { connected?: boolean; active?: string[]; app?: string };
    const active = json.active ?? [];
    if (!primed) {
      primed = true;
      baseline = new Set(active);
      if (options.app && json.connected && !active.some((name) => sameApp(name, options.app ?? ""))) return;
      if (options.app && json.connected && baseline.size === 0) return;
      return;
    }
    if (options.app && json.connected) {
      options.onConnected(options.app);
      stop();
      return;
    }
    const fresh = active.find((name) => ![...baseline].some((known) => sameApp(known, name)));
    if (!options.app && fresh) {
      options.onConnected(fresh);
      stop();
    }
  }

  function onWake() {
    if (document.visibilityState === "hidden") return;
    void check();
  }

  const timer = window.setInterval(() => void check(), intervalMs);
  window.addEventListener("focus", onWake);
  document.addEventListener("visibilitychange", onWake);
  void check();

  function stop() {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener("focus", onWake);
    document.removeEventListener("visibilitychange", onWake);
  }

  return stop;
}
