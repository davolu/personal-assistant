-- Agentic chat: LangGraph checkpoints, pgvector memory, per-user desktops.
-- Checkpoint statements match @langchain/langgraph-checkpoint-postgres setup().
-- The runtime also calls checkpointer.setup(), which is safe to repeat.

CREATE TABLE IF NOT EXISTS checkpoint_migrations (
  v INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS checkpoints (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS checkpoint_blobs (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS checkpoint_writes (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  blob BYTEA NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

ALTER TABLE checkpoint_blobs ALTER COLUMN blob DROP NOT NULL;
ALTER TABLE checkpoint_writes ADD COLUMN IF NOT EXISTS task_path TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS agentic_thread (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agentic_thread_user_idx ON agentic_thread (user_id, updated_at DESC);
ALTER TABLE agentic_thread ADD COLUMN IF NOT EXISTS model_id TEXT NOT NULL DEFAULT '';
ALTER TABLE agentic_thread ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS agentic_desktop (
  user_id TEXT PRIMARY KEY,
  sandbox_id TEXT NOT NULL,
  stream_url TEXT NOT NULL DEFAULT '',
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paused_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agentic_memory_fact (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agentic_memory_fact_user_idx ON agentic_memory_fact (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agentic_episode (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  lesson TEXT NOT NULL DEFAULT '',
  embedding_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agentic_episode_user_idx ON agentic_episode (user_id, created_at DESC);

ALTER TABLE agentic_thread ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'chat';

CREATE TABLE IF NOT EXISTS agentic_schedule (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  cadence JSONB NOT NULL,
  cron TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'active',
  allow_risky BOOLEAN NOT NULL DEFAULT false,
  notify BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMPTZ,
  last_run_at TIMESTAMPTZ,
  last_status TEXT NOT NULL DEFAULT '',
  last_summary TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agentic_schedule_user_idx ON agentic_schedule (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS agentic_schedule_due_idx ON agentic_schedule (status, next_run_at);

CREATE TABLE IF NOT EXISTS agentic_schedule_run (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  run_thread_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  summary TEXT NOT NULL DEFAULT '',
  notify BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS agentic_schedule_run_once ON agentic_schedule_run (schedule_id, scheduled_for);
CREATE INDEX IF NOT EXISTS agentic_schedule_run_user_idx ON agentic_schedule_run (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agentic_schedule_run_thread_idx ON agentic_schedule_run (thread_id, started_at DESC);
