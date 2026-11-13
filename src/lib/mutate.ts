"use client";

import { readableError } from "@/lib/readable-error";
import { friendlyText, notify, type ToastTone } from "@/lib/toast";

export type ToastDecision = { tone: ToastTone; message: string } | null;

type MutateBody = string | FormData | URLSearchParams | Blob | Record<string, unknown> | unknown[] | null;

export type MutateInit = {
  method?: string;
  headers?: HeadersInit;
  body?: MutateBody;
  signal?: AbortSignal;
  /** Short success line. Writes default to Saved or Deleted. */
  success?: string;
  /** Used when the response has no friendly error string. */
  failure?: string;
  /** "all" toasts the outcome, "error" only failures, "off" neither. */
  toast?: "all" | "error" | "off";
  /**
   * "response" leaves a successful body unread so the caller can stream it.
   * Success is not toasted, because the stream can still fail.
   */
  read?: "json" | "response";
  /** Replaces the default success toast for a 2xx JSON body. Null skips it. */
  outcome?: (data: unknown) => ToastDecision;
};

export type MutateResult<T> = {
  ok: boolean;
  status: number;
  data: T;
  error: string | null;
  response: Response | null;
};

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const NETWORK_ERROR = "Couldn't reach the server — try again.";

export async function mutate<T = unknown>(input: string, init: MutateInit = {}): Promise<MutateResult<T>> {
  const method = (init.method ?? "POST").toUpperCase();
  const toastMode = init.toast ?? (WRITE.has(method) ? "all" : "off");
  const failure = init.failure ?? "Something went wrong — try again.";
  let response: Response;
  try {
    response = await fetch(input, requestInit(method, init));
  } catch {
    if (toastMode !== "off") notify(NETWORK_ERROR, "error");
    return { ok: false, status: 0, data: {} as T, error: NETWORK_ERROR, response: null };
  }

  if (!response.ok) {
    const message = friendlyText(readableError(await response.json().catch(() => null), failure), failure);
    if (toastMode !== "off") notify(message, "error");
    return { ok: false, status: response.status, data: {} as T, error: message, response };
  }

  if (init.read === "response") {
    return { ok: true, status: response.status, data: {} as T, error: null, response };
  }

  const data = await response.json().catch(() => null);
  if (toastMode === "all") {
    const decision = init.outcome ? init.outcome(data) : { tone: "success" as const, message: init.success ?? defaultSuccess(method) };
    if (decision) notify(decision.message, decision.tone);
  } else if (toastMode === "error" && init.outcome) {
    const decision = init.outcome(data);
    if (decision?.tone === "error") notify(decision.message, "error");
  }
  return { ok: true, status: response.status, data: data as T, error: null, response };
}

export async function runMutation<T>(
  work: () => Promise<T>,
  options: { success?: string; failure?: string; result?: (value: T) => ToastDecision } = {},
): Promise<{ ok: boolean; value?: T; error: string | null }> {
  const failure = options.failure ?? "Something went wrong — try again.";
  try {
    const value = await work();
    const decision = options.result ? options.result(value) : { tone: "success" as const, message: options.success ?? "Saved" };
    if (decision) notify(decision.message, decision.tone);
    const failed = decision?.tone === "error";
    return { ok: !failed, value, error: failed ? decision?.message ?? failure : null };
  } catch {
    notify(failure, "error");
    return { ok: false, error: failure };
  }
}

export async function copyText(text: string): Promise<{ ok: boolean; error: string | null }> {
  const value = text.trim();
  if (!value) {
    notify("Nothing to copy", "warning");
    return { ok: false, error: "Nothing to copy" };
  }
  return runMutation(() => navigator.clipboard.writeText(value), { success: "Copied", failure: "Couldn't copy that" });
}

function defaultSuccess(method: string): string {
  return method === "DELETE" ? "Deleted" : "Saved";
}

function requestInit(method: string, init: MutateInit): RequestInit {
  const headers = new Headers(init.headers);
  let body: BodyInit | undefined;
  if (init.body !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof init.body === "string" || init.body instanceof FormData || init.body instanceof URLSearchParams || init.body instanceof Blob) {
      body = init.body;
    } else {
      body = JSON.stringify(init.body);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
  }
  return { method, headers, body, signal: init.signal };
}
