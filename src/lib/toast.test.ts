import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastViewport } from "@/components/Toaster";
import { copyText, mutate, runMutation } from "@/lib/mutate";
import {
  dismissToast,
  friendlyText,
  getToasts,
  MAX_TOASTS,
  notify,
  resetToasts,
  TOAST_DURATION_MS,
  toastExitMs,
} from "@/lib/toast";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("toasts stack, dismiss, and auto-dismiss after about four seconds", () => {
  resetToasts();
  assert.equal(TOAST_DURATION_MS, 4000);
  assert.equal(toastExitMs(false), 180);
  assert.equal(toastExitMs(true), 0);
  notify("Saved", "success");
  notify("Saved", "success");
  notify("Could not save that", "error");
  assert.equal(getToasts().length, 2);
  assert.equal(getToasts()[0]?.message, "Saved");
  assert.equal(getToasts()[0]?.tone, "success");
  assert.equal(getToasts()[1]?.tone, "error");
  dismissToast(getToasts()[0]!.id);
  assert.equal(getToasts().length, 1);
  resetToasts();
  for (let index = 0; index < MAX_TOASTS + 1; index += 1) notify(`Note ${index}`, "info");
  assert.equal(getToasts().length, MAX_TOASTS);
  assert.equal(getToasts()[0]?.message, "Note 1");
  assert.equal(notify("   ", "info"), "");
});

test("friendly errors stay sentences and never show raw JSON", () => {
  assert.equal(friendlyText({ error: "Sign in first" }, "fallback"), "Sign in first");
  assert.equal(friendlyText({ message: "Already resolved" }, "fallback"), "Already resolved");
  assert.equal(friendlyText({ error: '{"stack":"boom"}' }, "Try again."), "Try again.");
  assert.equal(friendlyText("[{}]", "Try again."), "Try again.");
  assert.equal(friendlyText(null, "Try again."), "Try again.");
  assert.equal(friendlyText("  line\nbreak  ", "Try again."), "line break");
  const long = "word ".repeat(80);
  assert.ok(friendlyText(long, "Try again.").endsWith("…"));
  assert.ok(friendlyText(long, "Try again.").length <= 220);
});

test("mutate toasts writes by default and leaves loads quiet", async () => {
  resetToasts();
  const calls: { url: string; method: string; body: string | null }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url: String(input), method, body: typeof init?.body === "string" ? init.body : null });
    if (String(input).endsWith("/missing")) return jsonResponse({ error: "Schedule not found" }, 404);
    if (String(input).endsWith("/json-error")) return jsonResponse({ error: { detail: "nope" } }, 500);
    if (String(input).endsWith("/raw")) return jsonResponse({ error: '{"ok":false}' }, 400);
    if (String(input).endsWith("/html")) return new Response("<html>nope</html>", { status: 500, headers: { "content-type": "text/html" } });
    if (String(input).endsWith("/down")) throw new Error("socket");
    if (String(input).endsWith("/stream")) return new Response("data: hi", { status: 200, headers: { "content-type": "text/event-stream" } });
    if (String(input).endsWith("/wait")) return jsonResponse({ status: "waiting", summary: "Hold" });
    return jsonResponse({ ok: true });
  }) as typeof fetch;

  try {
    const saved = await mutate("/api/example", { method: "POST", body: { name: "Friday" } });
    assert.equal(saved.ok, true);
    assert.equal(getToasts().at(-1)?.message, "Saved");
    assert.equal(calls.at(-1)?.body, JSON.stringify({ name: "Friday" }));

    resetToasts();
    const removed = await mutate("/api/example", { method: "DELETE" });
    assert.equal(removed.ok, true);
    assert.equal(getToasts()[0]?.message, "Deleted");

    resetToasts();
    const named = await mutate("/api/example", { method: "PATCH", success: "Schedule saved" });
    assert.equal(named.ok, true);
    assert.equal(getToasts()[0]?.message, "Schedule saved");

    resetToasts();
    const missing = await mutate("/api/missing", { failure: "Could not update that schedule" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "Schedule not found");
    assert.equal(getToasts()[0]?.tone, "error");
    assert.equal(getToasts()[0]?.message, "Schedule not found");

    resetToasts();
    const raw = await mutate("/api/raw", { failure: "Could not save that" });
    assert.equal(raw.error, "Could not save that");
    assert.equal(getToasts()[0]?.message, "Could not save that");
    assert.equal(JSON.stringify(getToasts()).includes("ok"), false);

    resetToasts();
    const html = await mutate("/api/html", { failure: "Something went wrong — try again." });
    assert.equal(html.error, "Something went wrong — try again.");

    resetToasts();
    const nested = await mutate("/api/json-error", { failure: "Something went wrong — try again." });
    assert.equal(nested.error, "Something went wrong — try again.");

    resetToasts();
    const down = await mutate("/api/down");
    assert.equal(down.status, 0);
    assert.equal(down.error, "Couldn't reach the server — try again.");

    resetToasts();
    const loaded = await mutate("/api/example", { method: "GET" });
    assert.equal(loaded.ok, true);
    assert.equal(getToasts().length, 0);

    resetToasts();
    await mutate("/api/example", { method: "POST", toast: "off", success: "Nope" });
    assert.equal(getToasts().length, 0);

    resetToasts();
    const waiting = await mutate("/api/wait", {
      outcome: () => ({ tone: "warning", message: "Waiting for approval" }),
    });
    assert.equal(waiting.ok, true);
    assert.equal(getToasts()[0]?.tone, "warning");
    assert.equal(getToasts()[0]?.message, "Waiting for approval");

    resetToasts();
    const streamed = await mutate("/api/stream", { read: "response", success: "Should not show" });
    assert.equal(streamed.ok, true);
    assert.equal(getToasts().length, 0);
    assert.equal(await streamed.response?.text(), "data: hi");
  } finally {
    globalThis.fetch = original;
    resetToasts();
  }
});

test("copy and other promise actions toast once", async () => {
  resetToasts();
  const writes: string[] = [];
  const original = globalThis.navigator;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: async (value: string) => writes.push(value) } },
  });
  try {
    const copied = await copyText("  hello  ");
    assert.equal(copied.ok, true);
    assert.deepEqual(writes, ["hello"]);
    assert.equal(getToasts()[0]?.message, "Copied");
    assert.equal(getToasts()[0]?.tone, "success");

    resetToasts();
    const empty = await copyText("  ");
    assert.equal(empty.ok, false);
    assert.equal(getToasts()[0]?.message, "Nothing to copy");
    assert.equal(getToasts()[0]?.tone, "warning");

    resetToasts();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { clipboard: { writeText: async () => Promise.reject(new Error("denied")) } },
    });
    const denied = await copyText("a note");
    assert.equal(denied.ok, false);
    assert.equal(getToasts()[0]?.message, "Couldn't copy that");

    resetToasts();
    const signed = await runMutation(async () => ({ error: null }), {
      result: (value) => (value.error ? { tone: "error", message: "No" } : { tone: "success", message: "Signed in" }),
    });
    assert.equal(signed.ok, true);
    assert.equal(getToasts()[0]?.message, "Signed in");

    resetToasts();
    const failed = await runMutation(async () => Promise.reject(new Error("down")), { failure: "Couldn't sign out — try again." });
    assert.equal(failed.ok, false);
    assert.equal(failed.error, "Couldn't sign out — try again.");
  } finally {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: original });
    resetToasts();
  }
});

test("toast viewport is a live stack with a dismiss control", () => {
  const html = renderToStaticMarkup(
    createElement(ToastViewport, {
      onDismiss: () => undefined,
      toasts: [
        { id: "t1", tone: "success", message: "Schedule saved", durationMs: 4000, createdAt: 0 },
        { id: "t2", tone: "error", message: "Could not save that", durationMs: 4000, createdAt: 1 },
      ],
    }),
  );
  assert.match(html, /data-toast-region/);
  assert.match(html, /aria-label="Notifications"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /data-tone="success"/);
  assert.match(html, /data-tone="error"/);
  assert.match(html, /Schedule saved/);
  assert.match(html, /Could not save that/);
  assert.match(html, /aria-label="Dismiss"/);
  assert.match(html, /toast-in/);
  assert.match(html, /toast-region/);
  assert.match(html, /safe-area-inset-left/);
  assert.match(html, /safe-area-inset-right/);
  assert.match(html, /border-l-mint/);
  assert.match(html, /border-l-coral/);
  const leaving = renderToStaticMarkup(
    createElement(ToastViewport, {
      onDismiss: () => undefined,
      leaving: new Set(["t1"]),
      toasts: [{ id: "t1", tone: "info", message: "Hello", durationMs: 4000, createdAt: 0 }],
    }),
  );
  assert.match(leaving, /toast-out/);
  assert.match(leaving, /data-tone="info"/);
  assert.match(leaving, /border-l-blue/);
});

test("toast motion respects reduced motion and the helper stays generic", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*\.toast-in,\s*\n\s*\.toast-out,/);
  assert.match(css, /data-keyboard="open"\] \.toast-region/);
  assert.match(css, /\.toast-region[\s\S]*safe-area-inset-top/);
  assert.match(css, /@keyframes toast-in/);
  assert.match(css, /@keyframes toast-out/);

  const helper = readFileSync(new URL("./mutate.ts", import.meta.url), "utf8");
  const store = readFileSync(new URL("./toast.ts", import.meta.url), "utf8");
  assert.doesNotMatch(`${helper}\n${store}`, /claude|gpt-|gemini|gmail|schedule|oauth|approval/i);

  const chat = readFileSync(new URL("../app/agentic-chat/AgenticChatClient.tsx", import.meta.url), "utf8");
  const delta = chat.slice(chat.indexOf('event.type === "text-delta"'), chat.indexOf('event.type === "data-hold"'));
  assert.equal(delta.includes("notify"), false);
  assert.equal(delta.includes("mutate"), false);
});
