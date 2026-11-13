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
  };
}

export interface DesktopSession extends DesktopHandle {
  pause(): Promise<void>;
}

export interface DesktopFactory {
  create(userId: string): Promise<DesktopSession>;
  connect(sandboxId: string): Promise<DesktopSession>;
}

/**
 * One desktop per user. The first use creates it. Later uses connect, which
 * resumes a paused sandbox. Idle machines are paused so logins and files stay.
 */
export function createDesktopManager(opts: { store: DesktopStore; factory: DesktopFactory; now: () => number; idleMs: number }) {
  return {
    async open(userId: string): Promise<DesktopSession> {
      await this.pauseIdle(userId);
      const existing = await opts.store.get(userId);
      const session = existing ? await opts.factory.connect(existing.sandboxId) : await opts.factory.create(userId);
      await opts.store.save({
        userId,
        sandboxId: session.sandboxId,
        streamUrl: session.streamUrl ?? existing?.streamUrl ?? "",
        lastUsedAt: opts.now(),
        pausedAt: null,
      });
      return session;
    },
    async pauseIdle(exceptUserId?: string): Promise<number> {
      const now = opts.now();
      let paused = 0;
      for (const row of await opts.store.list()) {
        if (row.userId === exceptUserId || row.pausedAt) continue;
        if (now - row.lastUsedAt < opts.idleMs) continue;
        try {
          const session = await opts.factory.connect(row.sandboxId);
          await session.pause();
          await opts.store.save({ ...row, pausedAt: now });
          paused += 1;
        } catch {
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

export function e2bFactory(env: Record<string, string | undefined> = process.env): DesktopFactory {
  return {
    async create() {
      const { Sandbox } = await import("@e2b/desktop");
      const desktop = await Sandbox.create({
        resolution: [1024, 768],
        dpi: 96,
        timeoutMs: desktopIdleMs(env),
        apiKey: env.E2B_API_KEY,
      });
      return wrap(desktop);
    },
    async connect(sandboxId: string) {
      const { Sandbox } = await import("@e2b/desktop");
      const desktop = await Sandbox.connect(sandboxId, { apiKey: env.E2B_API_KEY });
      return wrap(desktop);
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
  };
}
