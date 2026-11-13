import pg from "pg";
import { embedText } from "@/assistant/model-client";
import { retrieve } from "@/assistant/memory";
import type { MemoryStore } from "./memory";
import type { EffectLedger } from "./graph";
import type { DesktopRecord, DesktopStore } from "./desktop";
import { effectLedgerSql, ledgerResultText, pickLedgerOwner } from "./ledger";

let pool: pg.Pool | null = null;
let vector: boolean | null = null;

export function agenticPool(): pg.Pool | null {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) return null;
  if (!pool) pool = new pg.Pool({ connectionString: url, max: 4 });
  return pool;
}

async function hasVector(db: pg.Pool): Promise<boolean> {
  if (vector !== null) return vector;
  const found = await db.query("SELECT 1 FROM pg_type WHERE typname = 'vector'");
  vector = found.rowCount === 1;
  return vector;
}

export function createPostgresMemory(): MemoryStore {
  return {
    async addFact(userId, text) {
      const db = agenticPool();
      if (!db) return;
      const embedding = await embedText(text).catch(() => null);
      const id = crypto.randomUUID();
      if (embedding && (await hasVector(db))) {
        await db.query(
          "INSERT INTO agentic_memory_fact (id, user_id, text, embedding_json, embedding) VALUES ($1, $2, $3, $4::jsonb, $5::vector)",
          [id, userId, text.slice(0, 500), JSON.stringify(embedding), `[${embedding.join(",")}]`]
        );
        return;
      }
      await db.query("INSERT INTO agentic_memory_fact (id, user_id, text, embedding_json) VALUES ($1, $2, $3, $4::jsonb)", [
        id,
        userId,
        text.slice(0, 500),
        embedding ? JSON.stringify(embedding) : null,
      ]);
    },
    async recall(userId, query) {
      const db = agenticPool();
      if (!db) return { facts: [], episodes: [] };
      const embedding = await embedText(query).catch(() => null);
      if (embedding && (await hasVector(db))) {
        const literal = `[${embedding.join(",")}]`;
        const facts = await db.query("SELECT text FROM agentic_memory_fact WHERE user_id = $1 AND embedding IS NOT NULL ORDER BY embedding <=> $2::vector LIMIT 5", [
          userId,
          literal,
        ]);
        const episodes = await db.query(
          "SELECT summary, lesson FROM agentic_episode WHERE user_id = $1 AND embedding IS NOT NULL ORDER BY embedding <=> $2::vector LIMIT 3",
          [userId, literal]
        );
        if (facts.rows.length || episodes.rows.length) {
          return {
            facts: facts.rows.map((row) => String(row.text)),
            episodes: episodes.rows.map((row) => `${row.summary} ${row.lesson}`.trim()),
          };
        }
      }
      const facts = await db.query("SELECT id, text FROM agentic_memory_fact WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200", [userId]);
      const episodes = await db.query("SELECT id, summary, lesson FROM agentic_episode WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50", [userId]);
      const factHits = retrieve(
        query,
        facts.rows.map((row) => ({ id: String(row.id), text: String(row.text), userId })),
        { userId, limit: 5, minScore: 0.05 }
      );
      const episodeHits = retrieve(
        query,
        episodes.rows.map((row) => ({ id: String(row.id), text: `${row.summary} ${row.lesson}`, userId })),
        { userId, limit: 3, minScore: 0.05 }
      );
      return { facts: factHits.map((hit) => hit.text), episodes: episodeHits.map((hit) => hit.text) };
    },
    async addEpisode(userId, episode) {
      const db = agenticPool();
      if (!db) return;
      const text = `${episode.summary}\n${episode.lesson}`;
      const embedding = await embedText(text).catch(() => null);
      const id = crypto.randomUUID();
      if (embedding && (await hasVector(db))) {
        await db.query(
          "INSERT INTO agentic_episode (id, user_id, thread_id, summary, lesson, embedding_json, embedding) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::vector)",
          [id, userId, episode.threadId, episode.summary.slice(0, 500), episode.lesson.slice(0, 500), JSON.stringify(embedding), `[${embedding.join(",")}]`]
        );
        return;
      }
      await db.query("INSERT INTO agentic_episode (id, user_id, thread_id, summary, lesson, embedding_json) VALUES ($1, $2, $3, $4, $5, $6::jsonb)", [
        id,
        userId,
        episode.threadId,
        episode.summary.slice(0, 500),
        episode.lesson.slice(0, 500),
        embedding ? JSON.stringify(embedding) : null,
      ]);
    },
  };
}

let ledgerOwnerSql: Promise<string> | null = null;

async function ledgerOwner(db: pg.Pool): Promise<string> {
  ledgerOwnerSql ??= db
    .query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'effect_ledger'
         AND column_name IN ('userId', 'user_id')`
    )
    .then((found) => pickLedgerOwner(found.rows.map((row) => String(row.column_name))));
  return ledgerOwnerSql;
}

export function createPostgresLedger(): EffectLedger {
  return {
    async get(userId, key) {
      const db = agenticPool();
      if (!db) return null;
      const sql = effectLedgerSql(await ledgerOwner(db));
      const found = await db.query(sql.get, [key, userId]);
      return ledgerResultText(found.rows[0]?.result);
    },
    async put(userId, key, result) {
      const db = agenticPool();
      if (!db) return;
      const sql = effectLedgerSql(await ledgerOwner(db));
      await db.query(sql.put, [key, userId, JSON.stringify({ content: result })]);
    },
  };
}

export function createPostgresDesktopStore(): DesktopStore {
  return {
    async get(userId) {
      const db = agenticPool();
      if (!db) return null;
      const found = await db.query("SELECT user_id, sandbox_id, stream_url, last_used_at, paused_at FROM agentic_desktop WHERE user_id = $1", [userId]);
      const row = found.rows[0];
      if (!row) return null;
      return toRecord(row);
    },
    async save(record) {
      const db = agenticPool();
      if (!db) return;
      await db.query(
        `INSERT INTO agentic_desktop (user_id, sandbox_id, stream_url, last_used_at, paused_at)
         VALUES ($1, $2, $3, to_timestamp($4 / 1000.0), CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5 / 1000.0) END)
         ON CONFLICT (user_id) DO UPDATE SET sandbox_id = EXCLUDED.sandbox_id, stream_url = EXCLUDED.stream_url, last_used_at = EXCLUDED.last_used_at, paused_at = EXCLUDED.paused_at`,
        [record.userId, record.sandboxId, record.streamUrl, record.lastUsedAt, record.pausedAt]
      );
    },
    async list() {
      const db = agenticPool();
      if (!db) return [];
      const found = await db.query("SELECT user_id, sandbox_id, stream_url, last_used_at, paused_at FROM agentic_desktop");
      return found.rows.map(toRecord);
    },
  };
}

function toRecord(row: { user_id: string; sandbox_id: string; stream_url: string; last_used_at: Date | string; paused_at: Date | string | null }): DesktopRecord {
  return {
    userId: row.user_id,
    sandboxId: row.sandbox_id,
    streamUrl: row.stream_url ?? "",
    lastUsedAt: new Date(row.last_used_at).getTime(),
    pausedAt: row.paused_at ? new Date(row.paused_at).getTime() : null,
  };
}

export async function ensureThread(userId: string, threadId: string, title: string) {
  const db = agenticPool();
  if (!db) return;
  await db.query(
    `INSERT INTO agentic_thread (id, user_id, title) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET title = CASE WHEN agentic_thread.title = '' THEN EXCLUDED.title ELSE agentic_thread.title END, updated_at = now()`,
    [threadId, userId, title.slice(0, 80)]
  );
}

export async function listThreads(userId: string) {
  const db = agenticPool();
  if (!db) return [];
  const found = await db.query(
    "SELECT id, title, updated_at, pinned_at FROM agentic_thread WHERE user_id = $1 ORDER BY pinned_at DESC NULLS LAST, updated_at DESC LIMIT 30",
    [userId]
  );
  return found.rows.map((row) => ({
    id: String(row.id),
    title: String(row.title || "New agent"),
    updatedAt: new Date(row.updated_at).toISOString(),
    pinned: Boolean(row.pinned_at),
  }));
}

export async function threadOwner(threadId: string): Promise<string | null> {
  const db = agenticPool();
  if (!db) return null;
  const found = await db.query("SELECT user_id FROM agentic_thread WHERE id = $1", [threadId]);
  const owner = found.rows[0]?.user_id;
  return typeof owner === "string" ? owner : null;
}

export async function deleteThread(userId: string, threadId: string) {
  const db = agenticPool();
  if (!db) return false;
  const removed = await db.query("DELETE FROM agentic_thread WHERE id = $1 AND user_id = $2", [threadId, userId]);
  if ((removed.rowCount ?? 0) < 1) return false;
  await db.query("DELETE FROM checkpoints WHERE thread_id = $1", [threadId]).catch(() => undefined);
  await db.query("DELETE FROM checkpoint_blobs WHERE thread_id = $1", [threadId]).catch(() => undefined);
  await db.query("DELETE FROM checkpoint_writes WHERE thread_id = $1", [threadId]).catch(() => undefined);
  return true;
}

export async function setThreadPinned(userId: string, threadId: string, pinned: boolean) {
  const db = agenticPool();
  if (!db) return false;
  const updated = await db.query(
    "UPDATE agentic_thread SET pinned_at = CASE WHEN $3::boolean THEN now() ELSE NULL END, updated_at = now() WHERE id = $1 AND user_id = $2",
    [threadId, userId, pinned]
  );
  return (updated.rowCount ?? 0) > 0;
}

export async function duplicateThread(userId: string, threadId: string): Promise<{ id: string; title: string; pinned: boolean } | null> {
  const db = agenticPool();
  if (!db) return null;
  const found = await db.query("SELECT title FROM agentic_thread WHERE id = $1 AND user_id = $2", [threadId, userId]);
  if (!found.rows[0]) return null;
  const id = crypto.randomUUID();
  const title = `Copy of ${String(found.rows[0].title || "New agent")}`.slice(0, 80);
  await db.query("INSERT INTO agentic_thread (id, user_id, title) VALUES ($1, $2, $3)", [id, userId, title]);
  await db.query(
    `INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata)
     SELECT $2, checkpoint_ns, checkpoint_id, parent_checkpoint_id, type, checkpoint, metadata
     FROM checkpoints WHERE thread_id = $1`,
    [threadId, id]
  ).catch(() => undefined);
  await db.query(
    `INSERT INTO checkpoint_blobs (thread_id, checkpoint_ns, channel, version, type, blob)
     SELECT $2, checkpoint_ns, channel, version, type, blob
     FROM checkpoint_blobs WHERE thread_id = $1`,
    [threadId, id]
  ).catch(() => undefined);
  await db.query(
    `INSERT INTO checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob)
     SELECT $2, checkpoint_ns, checkpoint_id, task_id, idx, channel, type, blob
     FROM checkpoint_writes WHERE thread_id = $1`,
    [threadId, id]
  ).catch(() => undefined);
  return { id, title, pinned: false };
}

/** Sets the display name. The first message still fills an empty title. */
export async function renameThread(userId: string, threadId: string, title: string) {
  const db = agenticPool();
  if (!db) return false;
  const clean = title.trim().slice(0, 80);
  if (!clean) return false;
  const updated = await db.query("UPDATE agentic_thread SET title = $3, updated_at = now() WHERE id = $1 AND user_id = $2", [threadId, userId, clean]);
  if ((updated.rowCount ?? 0) > 0) return true;
  await db.query(
    "INSERT INTO agentic_thread (id, user_id, title) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
    [threadId, userId, clean]
  );
  return true;
}

export async function setThreadModel(userId: string, threadId: string, modelId: string) {
  const db = agenticPool();
  if (!db) return;
  await db.query(
    `INSERT INTO agentic_thread (id, user_id, title, model_id) VALUES ($1, $2, '', $3)
     ON CONFLICT (id) DO UPDATE SET model_id = EXCLUDED.model_id, updated_at = now()
     WHERE agentic_thread.user_id = $2`,
    [threadId, userId, modelId.slice(0, 80)]
  );
}

export async function getThreadModel(userId: string, threadId: string): Promise<string | null> {
  const db = agenticPool();
  if (!db) return null;
  const found = await db.query("SELECT model_id FROM agentic_thread WHERE id = $1 AND user_id = $2", [threadId, userId]);
  const value = found.rows[0]?.model_id;
  return typeof value === "string" && value ? value : null;
}

export async function ownsThread(userId: string, threadId: string) {
  const db = agenticPool();
  if (!db) return true;
  const found = await db.query("SELECT user_id FROM agentic_thread WHERE id = $1", [threadId]);
  if (!found.rows[0]) return true;
  return found.rows[0].user_id === userId;
}
