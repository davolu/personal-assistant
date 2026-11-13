export type ToastTone = "success" | "error" | "info" | "warning";

export type ToastRecord = {
  id: string;
  tone: ToastTone;
  message: string;
  durationMs: number;
  createdAt: number;
};

export const TOAST_DURATION_MS = 4000;
export const TOAST_EXIT_MS = 180;
export const MAX_TOASTS = 4;
const DEDUPE_MS = 500;
const MAX_MESSAGE = 220;

const EMPTY: ToastRecord[] = [];

let toasts: ToastRecord[] = [];
let sequence = 0;
const listeners = new Set<() => void>();

export function toastExitMs(reduceMotion: boolean): number {
  return reduceMotion ? 0 : TOAST_EXIT_MS;
}

export function friendlyText(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value : textField(value);
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean || looksLikeRawJson(clean)) return fallback;
  if (clean.length <= MAX_MESSAGE) return clean;
  return `${clean.slice(0, MAX_MESSAGE - 1).trimEnd()}…`;
}

export function notify(message: string, tone: ToastTone = "info"): string {
  const text = friendlyText(message, "");
  if (!text) return "";
  const now = Date.now();
  const duplicate = toasts.find((toast) => toast.tone === tone && toast.message === text && now - toast.createdAt < DEDUPE_MS);
  if (duplicate) return duplicate.id;
  sequence += 1;
  const toast: ToastRecord = {
    id: `t${sequence}`,
    tone,
    message: text,
    durationMs: TOAST_DURATION_MS,
    createdAt: now,
  };
  toasts = [...toasts, toast].slice(-MAX_TOASTS);
  emit();
  return toast.id;
}

export function dismissToast(id: string): void {
  const next = toasts.filter((toast) => toast.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function getToasts(): ToastRecord[] {
  return toasts;
}

export function getServerToasts(): ToastRecord[] {
  return EMPTY;
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetToasts(): void {
  toasts = [];
  sequence = 0;
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}

function textField(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  for (const key of ["error", "message"]) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return "";
}

function looksLikeRawJson(text: string): boolean {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}
