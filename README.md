# AgentDocker

AgentDocker (https://agentdocker.io) creates autonomous agents by chatting. This repo is the app.

A chat assistant that works across your apps. You type. Claude plans. Code decides which tools may run. Sends, deletes, and payments wait until you approve that exact call.

MCP is the tool standard. [Composio](https://composio.dev) connects the long tail of apps with per-user OAuth. The current design is in [docs/AGENTIC_CHAT.md](docs/AGENTIC_CHAT.md).

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
| `TRUSTED_ORIGINS` | no | Extra sign-in origins, comma-separated. `https://agentdocker.io` and `https://www.agentdocker.io` are already in the default allowlist |
| `ANTHROPIC_API_KEY` | yes, for live chat | Claude Sonnet plans and acts. Haiku is the cheap model |
| `COMPOSIO_API_KEY` | for apps | Managed OAuth and the long tail. Connect apps at `/apps` |
| `COMPOSIO_WEBHOOK_SECRET` | for events | Point Composio at `https://<host>/api/webhooks/composio` |
| `BILLING_CRON_SECRET` or `CRON_SECRET` | for routines | `GET /api/assistant/cron` with `Authorization: Bearer <secret>` |
| `OPENAI_API_KEY` | no | Fallback chat model and embeddings. Without it, retrieval is keyword-only |
| `TOKEN_VAULT_KEY` | no | 32-byte base64 key. Only for direct MCP user tokens |
| `MCP_SERVERS` | no | JSON list of remote MCP servers. Official servers are not bundled |
| `BETTER_AUTH_URL` | yes, in production | Must be `https://agentdocker.io` on Vercel, not the `*.vercel.app` deployment URL |
| `NEXT_PUBLIC_APP_URL` | yes, in production | Same public origin, `https://agentdocker.io`. Used by absolute links outside the sign-in callback |
| `RESEND_API_KEY` / `EMAIL_FROM` | no | Password reset email. Both must be set or the Forgot password link stays hidden |
| `GOOGLE_CLIENT_ID` / `SECRET` | no | Google sign-in. Both must be set or the button stays hidden |
| `PAYSTACK_*` | no | Legacy template-catalog billing |
| `NEXT_PUBLIC_POSTHOG_KEY` | no | PostHog project key. Empty disables analytics |
| `NEXT_PUBLIC_POSTHOG_HOST` | no | Defaults to `https://us.i.posthog.com`. EU: `https://eu.i.posthog.com` |

### Google sign-in and password reset

Google sign-in is the only SSO provider. The button is rendered from the enabled-provider list, and it appears only when both Google env vars are set. Forgot password appears only when both Resend env vars are set. Leaving either pair empty hides that control and does not crash sign-in.

Register one Web OAuth client in Google Cloud Console. Authorized JavaScript origins:

- `https://agentdocker.io`
- `https://www.agentdocker.io`
- `https://personal-assistant-five-taupe.vercel.app`
- `http://localhost:3000`

Authorized redirect URIs:

- `https://agentdocker.io/api/auth/callback/google`
- `https://www.agentdocker.io/api/auth/callback/google`
- `https://personal-assistant-five-taupe.vercel.app/api/auth/callback/google`
- `http://localhost:3000/api/auth/callback/google`

Set both `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` to `https://agentdocker.io` in Vercel. Do not point either at `https://personal-assistant-five-taupe.vercel.app`. Google sign-in, sign-up, and password-reset links return to the trusted host the browser used (`agentdocker.io`, `www.agentdocker.io`, this project's Vercel host, or localhost). If that host is missing or not trusted, the redirect falls back to `https://agentdocker.io`. The callback path itself stays relative (`/dashboard`, `/reset-password`).

A Google sign-in with the same verified address links onto an existing account. Password sign-up does not mark the address verified, so linking is limited to Google, which attests the address. A password account created on an address the person does not own could receive a later Google sign-in for that address.

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
- `docs/AGENTIC_CHAT.md` — the current autonomous agent design.

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
| `NEXT_PUBLIC_POSTHOG_KEY` | no | PostHog project key. When empty, PostHog does not load |
| `NEXT_PUBLIC_POSTHOG_HOST` | no | Ingestion host. Defaults to `https://us.i.posthog.com`. EU: `https://eu.i.posthog.com` |

## Product analytics

PostHog records product events and session replays in the browser. Events go to `/ingest` on this app, and Next.js rewrites that path to `NEXT_PUBLIC_POSTHOG_HOST`, so ad blockers that drop `posthog.com` still let the events through. Both env vars are read at build time. This app does not set a Content-Security-Policy. If you add one, keep `/ingest` on the same origin and allow `worker-src 'self' blob:` so session replay can start.

In the PostHog project:

1. Turn on **Session replay**.
2. Add these authorized domains: `agentdocker.io`, `www.agentdocker.io`, and `personal-assistant-five-taupe.vercel.app`.

Replays mask every input, password fields, and anything that looks like a secret or API key. Chat message bodies, the composer, schedule instructions, and the cloud desktop frame are masked, so prompts are not in the recording. Layout and navigation stay visible. Reset-password URLs and token query params are stripped before they are sent.

Signed-in people are identified by their user id, with email and name as person properties. Sign-out calls `posthog.reset()`.

Custom events: `signed_up`, `signed_in`, `agent_chat_started`, `agent_run_completed`, `agent_run_failed`, `app_connected`, `schedule_created`, `plan_upgrade_clicked`.
