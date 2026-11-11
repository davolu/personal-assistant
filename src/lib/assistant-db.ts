import { Prisma, type PrismaClient } from "@prisma/client";
import type { ApprovalRecord, ResultEnvelope } from "@/assistant/types";
import type { AssistantStore } from "@/assistant/builtin";
import { redactForLog } from "@/assistant/filters";

function embedding(value: Prisma.JsonValue | null): number[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "number") ? (value as number[]) : undefined;
}

function asArgs(value: Prisma.JsonValue): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

export function createPrismaAssistantStore(prisma: PrismaClient): AssistantStore {
  return {
    async addNote(userId, text, idempotencyKey) {
      if (idempotencyKey) {
        const existing = await prisma.note.findFirst({ where: { userId, idempotencyKey } });
        if (existing) return { id: existing.id, created: false };
      }
      const note = await prisma.note.create({ data: { userId, text, idempotencyKey } });
      return { id: note.id, created: true };
    },
    async searchNotes(userId, query) {
      const notes = await prisma.note.findMany({
        where: { userId, ...(query ? { text: { contains: query, mode: "insensitive" } } : {}) },
        orderBy: { createdAt: "desc" },
        take: 8,
      });
      return notes.map((note) => ({ id: note.id, text: note.text }));
    },
    async addFact(userId, text, source) {
      await prisma.memoryFact.create({ data: { userId, text: text.slice(0, 200), source } });
    },
    async listFacts(userId) {
      const facts = await prisma.memoryFact.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 });
      return facts.map((fact) => ({ id: fact.id, userId, text: fact.text, embedding: embedding(fact.embedding) }));
    },
    async listChunks(userId) {
      const chunks = await prisma.docChunk.findMany({ where: { userId }, orderBy: { ordinal: "asc" }, take: 80 });
      return chunks.map((chunk) => ({
        id: chunk.id,
        userId,
        sourceId: chunk.sourceId,
        text: chunk.text,
        embedding: embedding(chunk.embedding),
      }));
    },
    async createApproval(approval) {
      await prisma.assistantApproval.create({
        data: {
          id: approval.id,
          userId: approval.userId,
          taskId: approval.taskId,
          tool: approval.tool,
          args: approval.args as Prisma.InputJsonValue,
          digest: approval.digest,
          expiresAt: new Date(approval.expiresAt),
          idempotencyKey: approval.idempotencyKey,
        },
      });
    },
    async getApproval(userId, id) {
      const row = await prisma.assistantApproval.findFirst({ where: { id, userId } });
      return row ? toApproval(row) : null;
    },
    async markApproval(userId, id, patch) {
      const updated = await prisma.assistantApproval.updateMany({
        where: { id, userId, status: "pending" },
        data: {
          status: patch.status,
          result: patch.result,
          args: patch.args as Prisma.InputJsonValue,
          digest: patch.digest,
          resolvedAt: new Date(),
        },
      });
      return updated.count === 1;
    },
    async addEpisode(userId, episode) {
      await prisma.episode.create({ data: { userId, ...episode } });
    },
    async audit(userId, action, tool, detail) {
      await prisma.auditEvent.create({ data: { userId, action, tool, detail: redactForLog(detail).slice(0, 500) } });
    },
    async getEffect(userId, key) {
      const row = await prisma.effectLedger.findFirst({ where: { key, userId } });
      return row ? (row.result as ResultEnvelope) : null;
    },
    async putEffect(userId, key, result) {
      await prisma.effectLedger.upsert({
        where: { key },
        create: { key, userId, result: result as Prisma.InputJsonValue },
        update: {},
      });
    },
  };
}

function toApproval(row: {
  id: string;
  userId: string;
  taskId: string;
  tool: string;
  args: Prisma.JsonValue;
  digest: string;
  status: string;
  expiresAt: Date;
  idempotencyKey: string;
}): ApprovalRecord {
  return {
    id: row.id,
    userId: row.userId,
    taskId: row.taskId,
    tool: row.tool,
    args: asArgs(row.args),
    digest: row.digest,
    status: row.status as ApprovalRecord["status"],
    expiresAt: row.expiresAt.toISOString(),
    idempotencyKey: row.idempotencyKey,
  };
}
