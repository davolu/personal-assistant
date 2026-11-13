# Agentic chat

`/agentic-chat` runs beside the original assistant. Nothing in `src/assistant` decides its steps.

Claude, with native tool calls and interleaved thinking, chooses whether to answer, search tools, connect an app, execute a read, ask, or use the desktop. Code only holds the walls: the effect gate, budgets, checkpoints, and the Jev check.

## What shipped

| Phase | Status |
|---|---|
| 0. Setup | Dependencies, env vars, SQL for checkpoints, pgvector facts, and desktop rows |
| 1. MVP loop | Page, LangGraph agent and tools nodes, Composio meta-tools, ask and approval and connect interrupts, todo list, streaming UI |
| 2. Smarter | Verify node (code claim check plus Jev), failure ledger, 40-call and 3-approach budgets, pgvector facts and episodes, compaction |
| 3. Durable | Graph checkpoints in Postgres on every node. Inngest function with `waitForEvent` for ask, approval, and connect. The streaming page uses the API route so it can be tested without the Inngest dev server |
| 4. Evals | `evals/agentic.json` has the 30 conversations. `npm run evals:agentic -- --dry` runs them in a sandbox. Live mode runs when `ANTHROPIC_API_KEY` is set |
| Desktop | `use_computer` is one tool among the others. Claude decides when a site or GUI has no API. The helper loops screenshot and action against that user's E2B desktop |

## Try it

```bash
cp .env.example .env
# ANTHROPIC_API_KEY is required for a live reply.
# COMPOSIO_API_KEY for apps. E2B_API_KEY for the desktop. TYPESAFE_API_KEY for Jev.

docker compose up -d
npm install
npm run db:agentic
npm run dev
```

Open http://localhost:3000/agentic-chat and sign in.

`docker-compose.yml` uses `pgvector/pgvector:pg16`. If that image is not available, facts fall back to keyword search and the page still runs. Without `DATABASE_URL`, checkpoints stay in process memory for that dev server.

## Inngest

The API route is the path the page streams on. It checkpoints every graph node, so a finished step can be resumed after a crash.

To move the turn onto Inngest:

```bash
# terminal 1
npm run dev
# terminal 2
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

Set `AGENTIC_RUNTIME=inngest`. The page's POST then enqueues `agentic/run.requested` and returns JSON. Ask, approval, and connect waits use `step.waitForEvent` (72 hours for an approval, then it rejects). Inngest Realtime is not wired into the chat stream; the live timeline is the API-route stream. Durable mode needs `DATABASE_URL` so the checkpointer is shared with the worker.

## Desktop

`E2B_API_KEY` creates one sandbox per user on the first `use_computer` call. The sandbox id is stored in `agentic_desktop`. The next call connects, which resumes a paused machine. Idle sandboxes are paused after `E2B_IDLE_MS` (10 minutes). The chat has a Computer panel with the stream URL. Sign-in, 2FA, and captchas pause on `ask_user` so you can take over. A submit, payment, or send from the desktop pauses on the approval card before the key or click runs.

The computer-use tool version follows `ANTHROPIC_MODEL`: `computer_20250124` for Sonnet 4.5, `computer_20251124` for later Sonnet 4.6-class models, and `computer_toolset_20260801` for Claude 5.5-class models.

## Checks

```bash
npm test
npm run typecheck
npm run evals:agentic -- --dry
```

The dry eval and the unit tests do not send email, post messages, or change a real account. Live evals use the same sandbox tools.
