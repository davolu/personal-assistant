import type { NormalizedAction } from "./computer";
import type { DesktopHandle } from "./computer";

export type DesktopRecord = {
  userId: string;
  sandboxId: string;
  streamUrl: string;
  lastUsedAt: number;
  pausedAt: number | null;
};

export interface DesktopStore {
  get(userId: string): Promise<DesktopRecord | null>;
  save(record: DesktopRecord): Promise<void>;
  list(): Promise<DesktopRecord[]>;
  delete(userId: string): Promise<void>;
}

export function memoryDesktopStore(): DesktopStore {
  const rows = new Map<string, DesktopRecord>();
  return {
    async get(userId) {
      return rows.get(userId) ?? null;
    },
    async save(record) {
      rows.set(record.userId, record);
    },
    async list() {
      return [...rows.values()];
    },
    async delete(userId) {
      rows.delete(userId);
    },
  };
}

export interface DesktopSession extends DesktopHandle {
  pause(): Promise<void>;
}

export interface DesktopFactory {
  create(userId: string): Promise<DesktopSession>;
  connect(sandboxId: string): Promise<DesktopSession>;
  /** Pause a sandbox without resuming it. Connect would wake a paused machine. */
  pause?(sandboxId: string): Promise<void>;
}

/**
 * E2B's connect call reports a missing, expired, or killed sandbox as
 * SandboxNotFoundError (a NotFoundError) with HTTP 404. The message is
 * "Paused sandbox <id> not found" even when the machine was killed.
 */
export function isMissingSandbox(err: unknown): boolean {
  if (err == null) return false;
  const record = typeof err === "object" ? (err as { name?: unknown; message?: unknown; statusCode?: unknown; code?: unknown }) : {};
  const name = typeof record.name === "string" ? record.name : "";
  const message = err instanceof Error ? err.message : typeof record.message === "string" ? record.message : typeof err === "string" ? err : "";
  const status = record.statusCode ?? record.code;
  if (name === "SandboxNotFoundError" || name === "NotFoundError") return true;
  if (status === 404 || status === "404") return true;
  return /sandbox/i.test(message) && /not found/i.test(message);
}

/** Keep the stream that belongs to the sandbox on screen. A new sandbox never keeps the old URL. */
export function adoptDesktop(
  current: { streamUrl?: string | null; sandboxId?: string | null },
  next: { streamUrl?: string | null; sandboxId?: string | null }
): { streamUrl: string; sandboxId: string } {
  const sandboxId = next.sandboxId || current.sandboxId || "";
  const replaced = Boolean(sandboxId && current.sandboxId && sandboxId !== current.sandboxId);
  if (replaced) return { streamUrl: next.streamUrl || "", sandboxId };
  return { streamUrl: next.streamUrl || current.streamUrl || "", sandboxId };
}

/**
 * One desktop per user. The first use creates it. Later uses connect, which
 * resumes a paused sandbox. Idle machines are paused so logins and files stay.
 * A stored sandbox E2B no longer has is dropped, and a new one is created in
 * the same call.
 */
export function createDesktopManager(opts: { store: DesktopStore; factory: DesktopFactory; now: () => number; idleMs: number }) {
  async function remember(userId: string, session: DesktopSession, previous: DesktopRecord | null) {
    const same = previous?.sandboxId === session.sandboxId;
    await opts.store.save({
      userId,
      sandboxId: session.sandboxId,
      streamUrl: session.streamUrl || (same ? previous?.streamUrl ?? "" : ""),
      lastUsedAt: opts.now(),
      pausedAt: null,
    });
  }
  return {
    async open(userId: string): Promise<DesktopSession> {
      await this.pauseIdle(userId);
      const existing = await opts.store.get(userId);
      if (existing?.sandboxId) {
        try {
          const session = await opts.factory.connect(existing.sandboxId);
          await remember(userId, session, existing);
          return session;
        } catch (err) {
          if (!isMissingSandbox(err)) throw err;
          await opts.store.delete(userId);
        }
      }
      const session = await opts.factory.create(userId);
      await remember(userId, session, null);
      return session;
    },
    async pauseIdle(exceptUserId?: string): Promise<number> {
      const now = opts.now();
      let paused = 0;
      for (const row of await opts.store.list()) {
        if (row.userId === exceptUserId || row.pausedAt || !row.sandboxId) continue;
        if (now - row.lastUsedAt < opts.idleMs) continue;
        try {
          if (opts.factory.pause) await opts.factory.pause(row.sandboxId);
          else {
            const session = await opts.factory.connect(row.sandboxId);
            await session.pause();
          }
          await opts.store.save({ ...row, pausedAt: now });
          paused += 1;
        } catch (err) {
          if (isMissingSandbox(err)) {
            await opts.store.delete(row.userId);
            continue;
          }
          await opts.store.save({ ...row, pausedAt: now });
        }
      }
      return paused;
    },
    async stream(userId: string): Promise<{ sandboxId: string; streamUrl: string } | null> {
      const row = await opts.store.get(userId);
      if (!row?.streamUrl) return null;
      return { sandboxId: row.sandboxId, streamUrl: row.streamUrl };
    },
  };
}

/** Window title from the desktop, plus a URL when that title contains one. */
export function observationFromWindowTitle(title: string): { url?: string; title?: string } {
  const clean = title.trim();
  if (!clean) return {};
  const match = clean.match(/https?:\/\/[^\s<>"']+/i);
  const url = match?.[0]?.replace(/[).,;]+$/, "");
  return url ? { title: clean, url } : { title: clean };
}

export async function performOnE2B(desktop: E2BDesktop, action: NormalizedAction): Promise<void> {
  const [x, y] = action.coordinate ?? [];
  if (action.kind === "left_click") return desktop.leftClick(x, y);
  if (action.kind === "double_click") return desktop.doubleClick(x, y);
  if (action.kind === "right_click") return desktop.rightClick(x, y);
  if (action.kind === "middle_click") return desktop.middleClick(x, y);
  if (action.kind === "mouse_move" && x !== undefined && y !== undefined) return desktop.moveMouse(x, y);
  if (action.kind === "type") return desktop.write(action.text ?? "");
  if (action.kind === "key") {
    const key = (action.text || "enter").toLowerCase();
    const times = Math.min(Math.max(action.repeat ?? 1, 1), 20);
    for (let i = 0; i < times; i++) await desktop.press(key);
    return;
  }
  if (action.kind === "scroll") {
    const direction = action.direction === "up" ? "up" : "down";
    return desktop.scroll(direction, action.amount ?? 3);
  }
  if (action.kind === "left_click_drag" && action.start && action.coordinate) return desktop.drag(action.start, action.coordinate);
  if (action.kind === "wait") {
    await new Promise((resolve) => setTimeout(resolve, Math.min((action.amount ?? 1) * 1000, 5000)));
    return;
  }
  if (action.kind === "cursor_position") {
    await desktop.getCursorPosition();
    return;
  }
  throw new Error(`Desktop action ${action.kind} is not supported.`);
}

type E2BDesktop = {
  leftClick(x?: number, y?: number): Promise<void>;
  doubleClick(x?: number, y?: number): Promise<void>;
  rightClick(x?: number, y?: number): Promise<void>;
  middleClick(x?: number, y?: number): Promise<void>;
  moveMouse(x: number, y: number): Promise<void>;
  write(text: string): Promise<void>;
  press(key: string | string[]): Promise<void>;
  scroll(direction?: "up" | "down", amount?: number): Promise<void>;
  drag(from: [number, number], to: [number, number]): Promise<void>;
  getCursorPosition(): Promise<{ x: number; y: number }>;
};

/** Idle pause. Defaults to 3 minutes. E2B_IDLE_MS overrides it, with a 30 second floor. */
export function desktopIdleMs(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number(env.E2B_IDLE_MS);
  if (Number.isFinite(parsed) && parsed >= 30_000) return parsed;
  return 3 * 60 * 1000;
}

/**
 * Hobby and Starter reject a running timeout above one hour. Pro allows 24 hours.
 * Pausing on idle stays well under either cap, so one hour is the safe ceiling.
 */
export const E2B_MAX_RUNNING_MS = 60 * 60 * 1000;

/**
 * How long a desktop may keep running. Each connect refreshes it, so an active
 * task does not hit the limit between slices. It is at least the idle window,
 * so the machine is not paused while a slice is still in progress, and never
 * above the one-hour Hobby/Starter cap. E2B_TIMEOUT_MS can raise it within that cap.
 */
export function desktopTimeoutMs(env: Record<string, string | undefined> = process.env): number {
  const idle = desktopIdleMs(env);
  const requested = Number(env.E2B_TIMEOUT_MS);
  const chosen = Number.isFinite(requested) && requested > 0 ? Math.max(requested, idle) : idle;
  return Math.min(Math.max(chosen, 30_000), E2B_MAX_RUNNING_MS);
}

/**
 * Running timeout, and pause instead of kill when it lands. A killed sandbox
 * cannot be resumed: the next connect is a 404. A paused one is kept and
 * Sandbox.connect resumes it. Pausing also resets the one-hour continuous cap.
 */
export function desktopSandboxConfig(env: Record<string, string | undefined> = process.env): {
  timeoutMs: number;
  lifecycle: { onTimeout: "pause" };
} {
  return { timeoutMs: desktopTimeoutMs(env), lifecycle: { onTimeout: "pause" } };
}

/**
 * The package name resolves to a CommonJS file that `require()`s ESM-only chalk.
 * Load it from the ESM loader instead, and keep this import opaque to the
 * server bundler so it is not rewritten to `require()`.
 */
async function loadE2BDesktop(): Promise<typeof import("@e2b/desktop")> {
  const { pathToFileURL } = await import("node:url");
  const { join } = await import("node:path");
  const loaderUrl = pathToFileURL(join(process.cwd(), "src/agentic/e2b-desktop-loader.mjs")).href;
  const loader = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ loaderUrl)) as {
    loadE2BDesktop: () => Promise<typeof import("@e2b/desktop")>;
  };
  return loader.loadE2BDesktop();
}

export function e2bFactory(env: Record<string, string | undefined> = process.env): DesktopFactory {
  return {
    async create() {
      const { Sandbox } = await loadE2BDesktop();
      const desktop = await Sandbox.create({
        resolution: [1024, 768],
        dpi: 96,
        ...desktopSandboxConfig(env),
        apiKey: env.E2B_API_KEY,
      });
      return wrap(desktop);
    },
    async connect(sandboxId: string) {
      const { Sandbox } = await loadE2BDesktop();
      const desktop = await Sandbox.connect(sandboxId, { apiKey: env.E2B_API_KEY, timeoutMs: desktopTimeoutMs(env) });
      return wrap(desktop);
    },
    async pause(sandboxId: string) {
      const { Sandbox } = await loadE2BDesktop();
      await Sandbox.pause(sandboxId, { apiKey: env.E2B_API_KEY });
    },
  };
}

async function wrap(desktop: {
  sandboxId: string;
  stream: { start: (opts?: { requireAuth?: boolean }) => Promise<void>; getUrl: (opts?: { authKey?: string }) => string; getAuthKey?: () => Promise<string> | string };
  screenshot: () => Promise<Uint8Array>;
  pause: () => Promise<boolean | void>;
  leftClick: E2BDesktop["leftClick"];
  doubleClick: E2BDesktop["doubleClick"];
  rightClick: E2BDesktop["rightClick"];
  middleClick: E2BDesktop["middleClick"];
  moveMouse: E2BDesktop["moveMouse"];
  write: E2BDesktop["write"];
  press: E2BDesktop["press"];
  scroll: E2BDesktop["scroll"];
  drag: E2BDesktop["drag"];
  getCursorPosition: E2BDesktop["getCursorPosition"];
  getCurrentWindowId?: () => Promise<string>;
  getWindowTitle?: (windowId: string) => Promise<string>;
}): Promise<DesktopSession> {
  let streamUrl: string | null = null;
  try {
    await desktop.stream.start();
    streamUrl = desktop.stream.getUrl();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!/already running/i.test(message)) throw err;
    try {
      streamUrl = desktop.stream.getUrl();
    } catch {
      streamUrl = null;
    }
  }
  return {
    sandboxId: desktop.sandboxId,
    streamUrl,
    async screenshot() {
      const bytes = await desktop.screenshot();
      return Buffer.from(bytes).toString("base64");
    },
    perform: (action) => performOnE2B(desktop, action),
    pause: () => desktop.pause().then(() => undefined),
    async observe() {
      if (!desktop.getCurrentWindowId || !desktop.getWindowTitle) return {};
      try {
        const windowId = String(await desktop.getCurrentWindowId() ?? "").trim();
        if (!windowId) return {};
        return observationFromWindowTitle(String(await desktop.getWindowTitle(windowId) ?? ""));
      } catch {
        return {};
      }
    },
  };
}
