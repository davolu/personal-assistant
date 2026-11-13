"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  dismissToast,
  getServerToasts,
  getToasts,
  subscribeToasts,
  toastExitMs,
  type ToastRecord,
  type ToastTone,
} from "@/lib/toast";

const TONE: Record<ToastTone, { bar: string; mark: string; glyph: string }> = {
  success: { bar: "border-l-success", mark: "bg-success-soft text-success", glyph: "✓" },
  error: { bar: "border-l-accent", mark: "bg-accent-soft text-accent", glyph: "!" },
  info: { bar: "border-l-info", mark: "bg-info-soft text-info", glyph: "i" },
  warning: { bar: "border-l-warning", mark: "bg-gold-soft text-gold", glyph: "!" },
};

export function ToastViewport({
  toasts,
  leaving,
  onDismiss,
  onHold,
  onRelease,
}: {
  toasts: ToastRecord[];
  leaving?: ReadonlySet<string>;
  onDismiss: (id: string) => void;
  onHold?: () => void;
  onRelease?: () => void;
}) {
  return (
    <div
      data-toast-region
      aria-label="Notifications"
      className="toast-region pointer-events-none fixed z-[80] flex justify-center"
      style={{
        paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
        paddingRight: "max(0.75rem, env(safe-area-inset-right))",
      }}
    >
      {toasts.length > 0 && (
        <div
          className="pointer-events-auto flex w-[min(22rem,100%)] flex-col gap-2"
          onPointerEnter={(event) => {
            if (event.pointerType !== "touch") onHold?.();
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") onRelease?.();
          }}
          onFocus={() => onHold?.()}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onRelease?.();
          }}
        >
          {toasts.map((toast) => {
            const tone = TONE[toast.tone];
            const exit = leaving?.has(toast.id);
            return (
              <div
                key={toast.id}
                role="status"
                aria-live="polite"
                data-toast
                data-tone={toast.tone}
                className={`pointer-events-auto flex w-full items-start gap-3 rounded-2xl border border-line border-l-[6px] bg-panel py-3 pl-3 pr-1 shadow-[0_18px_40px_-24px_rgba(22,24,15,0.6)] ${tone.bar} ${exit ? "toast-out" : "toast-in"}`}
              >
                <span aria-hidden="true" className={`mt-0.5 grid size-7 shrink-0 -rotate-6 place-items-center rounded-full text-sm font-bold ${tone.mark}`}>
                  {tone.glyph}
                </span>
                <p className="min-w-0 flex-1 pt-1 text-sm font-semibold leading-snug text-ink">{toast.message}</p>
                <button
                  type="button"
                  aria-label="Dismiss"
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-lg leading-none text-muted hover:bg-ground hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  onClick={() => onDismiss(toast.id)}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Toaster() {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts, getServerToasts);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, number>());
  const held = useRef(false);
  const mounted = useRef(true);

  const close = useCallback((id: string) => {
    const pending = timers.current.get(id);
    if (pending) window.clearTimeout(pending);
    timers.current.delete(id);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wait = toastExitMs(reduce);
    if (wait === 0) {
      dismissToast(id);
      return;
    }
    setLeaving((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
    window.setTimeout(() => {
      if (mounted.current) dismissToast(id);
    }, wait);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
    };
  }, []);

  useEffect(() => {
    setLeaving((current) => {
      const live = new Set(toasts.map((toast) => toast.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of current) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : current;
    });
  }, [toasts]);

  useEffect(() => {
    const live = new Set(toasts.map((toast) => toast.id));
    for (const [id, timer] of timers.current) {
      if (!live.has(id)) {
        window.clearTimeout(timer);
        timers.current.delete(id);
      }
    }
    if (held.current) return;
    for (const toast of toasts) {
      if (timers.current.has(toast.id) || leaving.has(toast.id)) continue;
      const delay = Math.max(0, toast.durationMs - (Date.now() - toast.createdAt));
      timers.current.set(toast.id, window.setTimeout(() => close(toast.id), delay));
    }
  }, [toasts, leaving, close]);

  function hold() {
    held.current = true;
    for (const timer of timers.current.values()) window.clearTimeout(timer);
    timers.current.clear();
  }

  function release() {
    if (!held.current) return;
    held.current = false;
    for (const toast of getToasts()) {
      if (leaving.has(toast.id) || timers.current.has(toast.id)) continue;
      timers.current.set(toast.id, window.setTimeout(() => close(toast.id), toast.durationMs));
    }
  }

  return <ToastViewport toasts={toasts} leaving={leaving} onDismiss={close} onHold={hold} onRelease={release} />;
}
