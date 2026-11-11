import type { ResultEnvelope } from "./types";
import type { ApprovalRecord } from "./types";
import type { AssistantStore } from "./builtin";

type Note = { id: string; userId: string; text: string; key: string };
type Fact = { id: string; userId: string; text: string; source: string };
type Chunk = { id: string; userId: string; sourceId: string; text: string; embedding?: number[] };
type Episode = { userId: string; taskId: string; summary: string; lesson: string };
type Audit = { userId: string; action: string; tool: string; detail: string };

export class MemoryStore implements AssistantStore {
  notes: Note[] = [];
  facts: Fact[] = [];
  chunks: Chunk[] = [];
  episodes: Episode[] = [];
  audits: Audit[] = [];
  approvals: ApprovalRecord[] = [];
  effects = new Map<string, { userId: string; result: ResultEnvelope }>();
  private n = 0;

  async addNote(userId: string, text: string, idempotencyKey: string) {
    const existing = idempotencyKey ? this.notes.find((note) => note.userId === userId && note.key === idempotencyKey) : undefined;
    if (existing) return { id: existing.id, created: false };
    const id = `note_${++this.n}`;
    this.notes.push({ id, userId, text, key: idempotencyKey });
    return { id, created: true };
  }
  async searchNotes(userId: string, query: string) {
    const q = query.toLowerCase();
    return this.notes.filter((note) => note.userId === userId && (!q || note.text.toLowerCase().includes(q))).map(({ id, text }) => ({ id, text }));
  }
  async addFact(userId: string, text: string, source: string) {
    this.facts.push({ id: `fact_${++this.n}`, userId, text, source });
  }
  async listFacts(userId: string) {
    return this.facts.filter((fact) => fact.userId === userId).map((fact) => ({ ...fact }));
  }
  async listChunks(userId: string) {
    return this.chunks.filter((chunk) => chunk.userId === userId).map((chunk) => ({ ...chunk }));
  }
  async createApproval(approval: ApprovalRecord) {
    this.approvals.push({ ...approval, status: "pending" });
  }
  async getApproval(userId: string, id: string) {
    return this.approvals.find((approval) => approval.id === id && approval.userId === userId) ?? null;
  }
  async markApproval(
    userId: string,
    id: string,
    patch: { status: "approved" | "rejected" | "expired"; result: string; args: Record<string, unknown>; digest: string }
  ) {
    const approval = this.approvals.find((row) => row.id === id && row.userId === userId && row.status === "pending");
    if (!approval) return false;
    approval.status = patch.status;
    approval.args = patch.args;
    approval.digest = patch.digest;
    return true;
  }
  async addEpisode(userId: string, episode: { taskId: string; summary: string; lesson: string }) {
    this.episodes.push({ userId, ...episode });
  }
  async audit(userId: string, action: string, tool: string, detail: string) {
    this.audits.push({ userId, action, tool, detail });
  }
  async getEffect(userId: string, key: string) {
    const row = this.effects.get(key);
    if (!row || row.userId !== userId) return null;
    return row.result;
  }
  async putEffect(userId: string, key: string, result: ResultEnvelope) {
    if (!this.effects.has(key)) this.effects.set(key, { userId, result });
  }
}
