import type { ResultEnvelope, ToolProvider, ToolSpec } from "./types";
import { classifyEffect } from "./policy";
import { retrieve } from "./memory";

export interface AssistantStore {
  addNote(userId: string, text: string, idempotencyKey: string): Promise<{ id: string; created: boolean }>;
  searchNotes(userId: string, query: string): Promise<{ id: string; text: string }[]>;
  addFact(userId: string, text: string, source: string): Promise<void>;
  listFacts(userId: string): Promise<{ id: string; text: string; userId: string; embedding?: number[] }[]>;
  listChunks(userId: string): Promise<{ id: string; text: string; sourceId: string; userId: string; embedding?: number[] }[]>;
  createApproval(approval: {
    id: string;
    userId: string;
    taskId: string;
    tool: string;
    args: Record<string, unknown>;
    digest: string;
    expiresAt: string;
    idempotencyKey: string;
  }): Promise<void>;
  getApproval(userId: string, id: string): Promise<import("./types").ApprovalRecord | null>;
  markApproval(
    userId: string,
    id: string,
    patch: { status: "approved" | "rejected" | "expired"; result: string; args: Record<string, unknown>; digest: string }
  ): Promise<boolean>;
  addEpisode(userId: string, episode: { taskId: string; summary: string; lesson: string }): Promise<void>;
  audit(userId: string, action: string, tool: string, detail: string): Promise<void>;
  getEffect(userId: string, key: string): Promise<ResultEnvelope | null>;
  putEffect(userId: string, key: string, result: ResultEnvelope): Promise<void>;
}

const SCHEMA = { type: "object", additionalProperties: true };

export function builtinTools(): ToolSpec[] {
  const specs: Omit<ToolSpec, "effect">[] = [
    { name: "builtin.clock.now", description: "Read the current time as an ISO timestamp", inputSchema: SCHEMA, provider: "builtin" },
    { name: "builtin.notes.search", description: "Search this user's notes", inputSchema: SCHEMA, provider: "builtin" },
    { name: "builtin.notes.add", description: "Save a note for this user", inputSchema: SCHEMA, provider: "builtin" },
    { name: "builtin.docs.search", description: "Search the user's uploaded documents", inputSchema: SCHEMA, provider: "builtin" },
    { name: "builtin.memory.remember", description: "Remember a short fact about the user", inputSchema: SCHEMA, provider: "builtin" },
    {
      name: "builtin.apps.connect",
      description: "Connect an app the user does not have yet, including Zoho, Zoho Mail, Zoho CRM, and Zoho Books. Returns a URL the user opens to approve access.",
      inputSchema: SCHEMA,
      provider: "builtin",
    },
  ];
  return specs.map((tool) => ({ ...tool, effect: classifyEffect(tool.name) }));
}

export function createBuiltinProvider(
  store: AssistantStore,
  now: () => Date,
  extras?: { connectApp?: (userId: string, app: string) => Promise<{ url: string; app: string } | { error: string }> }
): ToolProvider {
  return {
    id: "builtin",
    async list() {
      return builtinTools();
    },
    async call(userId, name, args) {
      if (name === "builtin.clock.now") return { ok: true, data: { now: now().toISOString() } };
      if (name === "builtin.notes.search") {
        const notes = await store.searchNotes(userId, String(args.query ?? ""));
        return { ok: true, data: { notes } };
      }
      if (name === "builtin.notes.add") {
        const text = String(args.text ?? "").slice(0, 2000);
        if (!text.trim()) return { ok: false, error: { code: "BAD_ARGS", message: "text is required" } };
        const key = String(args.idempotencyKey ?? "");
        const saved = await store.addNote(userId, text, key);
        return { ok: true, data: saved };
      }
      if (name === "builtin.docs.search") {
        const chunks = await store.listChunks(userId);
        const hits = retrieve(String(args.query ?? ""), chunks, { userId, limit: 4 });
        return { ok: true, data: { hits: hits.map((h) => ({ id: h.id, text: h.text, sourceId: h.sourceId })) } };
      }
      if (name === "builtin.memory.remember") {
        const text = String(args.text ?? "").trim().slice(0, 200);
        if (!text) return { ok: false, error: { code: "BAD_ARGS", message: "text is required" } };
        await store.addFact(userId, text, "user-via-agent");
        return { ok: true, data: { remembered: text } };
      }
      if (name === "builtin.apps.connect") {
        const app = String(args.app ?? args.toolkit ?? "").trim();
        if (!extras?.connectApp) return { ok: false, error: { code: "NOT_CONFIGURED", message: "Connect links are not configured." } };
        const link = await extras.connectApp(userId, app);
        if ("error" in link) return { ok: false, error: { code: "CONNECT_FAILED", message: link.error } };
        return { ok: true, data: { app: link.app, url: link.url } };
      }
      return { ok: false, error: { code: "TOOL_NOT_FOUND", message: name } };
    },
  };
}
