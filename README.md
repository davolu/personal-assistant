# Personal assistant

A chat assistant that works across your apps. You type. Claude plans. Code decides which tools may run. Sends, deletes, and payments wait until you approve that exact call.

MCP is the tool standard. [Composio](https://composio.dev) connects the long tail of apps with per-user OAuth. The design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). It follows the approved Miro board and the [Agentic Architect](https://github.com/davolu/agentic-architect-skill) process.

## Quick start

You need Node 22+, Docker (for Postgres), and an Anthropic API key.

```bash
cp .env.example .env
# Put a real BETTER_AUTH_SECRET and ANTHROPIC_API_KEY in .env.
# The database URL in .env.example already matches docker compose.

docker compose up -d
npx prisma db push
npm install
npm run dev
```

Open [http://localhost:3000/chat](http://localhost:3000/chat). Create an account, then talk to the assistant.

Without `ANTHROPIC_API_KEY` the chat starts and answers that the model is not configured. Clock, notes, and the approval gate still run in tests with no keys.

## Checks

```bash
npm test          # unit tests and the golden eval suite
npm run evals     # prints PROMOTE or HOLD
npm run typecheck
```

`npm test` does not call Anthropic, OpenAI, or Composio.

## Production database

The production database stays the one already configured as `DATABASE_URL`. The Vercel build runs `prisma generate`, then `node scripts/apply-schema.mjs`, which runs `prisma db push` against that database. The push only adds the missing `connection.scopes` column and the assistant tables. It does not pass `--accept-data-loss` and it does not reset the database. This repo has no migration history, so `migrate deploy` would try to create tables that already exist.

Leave `DATABASE_URL` available at build time. If that URL is pooled, also set `DATABASE_URL_UNPOOLED` to the direct connection string for the same database. DDL uses the unpooled URL. When it is empty, the script copies `DATABASE_URL`.

If the build log says the schema sync failed, run this against the existing database and redeploy:

```bash
DATABASE_URL="postgresql://..." DATABASE_URL_UNPOOLED="postgresql://..." npx prisma db push
```

The dashboard no longer reads `scopes`, so it can render before that column exists. If a query still hits a missing table, the page shows a setup message instead of a server error.

## What you need to set up

| Variable | Required | Why |
|---|---|---|
| `DATABASE_URL` | yes | Postgres. The compose file publishes `assistant:assistant@localhost:5432/assistant` |
| `BETTER_AUTH_SECRET` | yes | Session signing. `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | yes, for live chat | Claude Sonnet plans and acts. Haiku is the cheap model |
| `COMPOSIO_API_KEY` | for apps | Managed OAuth and the long tail. Connect apps at `/apps` |
| `COMPOSIO_WEBHOOK_SECRET` | for events | Point Composio at `https://<host>/api/webhooks/composio` |
| `BILLING_CRON_SECRET` or `CRON_SECRET` | for routines | `GET /api/assistant/cron` with `Authorization: Bearer <secret>` |
| `OPENAI_API_KEY` | no | Fallback chat model and embeddings. Without it, retrieval is keyword-only |
| `TOKEN_VAULT_KEY` | no | 32-byte base64 key. Only for direct MCP user tokens |
| `MCP_SERVERS` | no | JSON list of remote MCP servers. Official servers are not bundled |
| `GOOGLE_CLIENT_ID` / `SECRET` | no | Google sign-in |
| `PAYSTACK_*` | no | Legacy template-catalog billing |

## How a turn works

1. The chat route checks the session, the rate limit, and the daily budget.
2. The planner returns JSON. Code rejects a plan that does not match the schema.
3. The registry shows only the tools that overlap the step. Anything else is refused and not called.
4. Reads and internal writes run. Send, delete, and pay pause on an approval card for 72 hours.
5. Tool results are wrapped as data. They are not instructions.
6. The reply is checked for secrets and for claims the trace does not support, then streamed.

Routines (hourly, daily, weekly) and Composio event routines are queued in Postgres and run on the cron tick.

## Layout

- `src/assistant` — the runtime. No Next.js and no Prisma. This is what the tests run.
- `src/lib/assistant-runtime.ts` — Postgres, Composio, and MCP wiring.
- `src/app/chat` — the chat UI.
- `src/app/api/assistant` — chat, approvals, routines, upload, cron.
- `evals/golden.json` — the eval set.
- `docs/ARCHITECTURE.md` — the spec, including every Miro box.
- `docs/ADR-001-hybrid-architecture.md` — what changed from the template runner.

## Templates

`/agents` is the older catalog of hired template agents. New chat does not go through that runner. It is still there, including its own approval mode. Do not treat it as the architecture in `docs/ARCHITECTURE.md`.

## Local files

Uploaded text is chunked into Postgres. Non-text parsing is not enabled. `data/uploads` is for the local file store and is gitignored.

## Agentic chat

`/agentic-chat` is a separate assistant. The original chat in `src/assistant` is unchanged. Claude decides whether to answer, call a tool, connect an app, ask, or recover. Tool errors go back to Claude. Sends, deletes, and payments wait on an approval card. `use_computer` is available when no app API fits; Claude chooses when to use the user's E2B desktop.

Setup and the phase notes are in [docs/AGENTIC_CHAT.md](docs/AGENTIC_CHAT.md).

```bash
npm run db:agentic
npm run dev
# open http://localhost:3000/agentic-chat
npm run evals:agentic -- --dry
```

| Variable | Required | Why |
|---|---|---|
| `ANTHROPIC_API_KEY` | for live chat | Claude Sonnet, native tools and computer use |
| `ANTHROPIC_MODEL` | no | Defaults to `ANTHROPIC_MODEL_STRONG` or `claude-sonnet-4-5` |
| `COMPOSIO_API_KEY` | for apps | Tool router: search, connect, execute |
| `TYPESAFE_API_KEY` | no | Jev critic. Without it, a local claim check is used |
| `TYPESAFE_BASE_URL` | no | Defaults to `https://api.typesafe.ai` |
| `DATABASE_URL` | for durable memory | Checkpoints, facts, episodes, desktop ids |
| `E2B_API_KEY` | for the desktop | One persistent cloud computer per user |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | no | Durable runs when `AGENTIC_RUNTIME=inngest` |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | no | Tracing. No-op when either key is missing |
