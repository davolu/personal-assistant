# ADR 001 — From template runners to a hybrid chat assistant

## What was wrong with the old shape

The repo was a catalog of hired template agents. A run walked a saved procedure, or fell into a long tool loop, and an agent in auto mode could send, post, or delete without a fresh approval. That is a workflow product. The approved Miro board is a different product: one chat, MCP as the tool standard, Composio for the long tail, and a hard stop before send, delete, and pay.

The skill's rule is the same one the board is built on: the model proposes, the system disposes. A prompt telling the model not to send is not the control. The effect gate is.

## What this change does

- New turns go through `src/assistant`: planner, bounded ReAct loop, registry, router, context manager, MCP hub, effect gate, approvals, memory, queue.
- Claude is the main model. OpenAI is the optional fallback and the optional embedding model.
- External effects always hold. Unknown effects deny. The tool name wins if a provider marks a send as a read.
- The template catalog, Paystack billing, and `src/lib/runner.ts` stay. They are the previous product, not the chat path.

## What was kept

- Next.js, Prisma, Postgres, better-auth.
- Composio managed OAuth and the connection pages.
- Webhook signature checks and webhook-id dedupe.
- The idea of an effect class and an approval row. The chat gate is stricter than `src/lib/effects.ts`, which still serves the old runner.

## What was dropped from the chat path

- Auto mode for send, delete, and pay.
- Walking a pre-written procedure as the way a chat turn runs. Open chat does not know the steps in advance (Ch24). The plan is validated JSON, then a bounded loop.

## What is an extension point, and why

The skill says to use the smallest pattern that works, and the board's own roadmap puts several boxes after the first safe assistant. Those boxes are listed in `docs/ARCHITECTURE.md` and in `src/assistant/miro.ts`. A test fails if one of them disappears. The important ones:

- Mobile, push, email, and voice: the HTTP API is the seam.
- Official MCP servers and our own OAuth screens: the hub and the vault are the seams. Composio already hosts the long-tail consent flow, so building five OAuth apps in v1 would duplicate it.
- Email and coding sub-agents: the research worker is the only split with a named reason (context isolation, read-only). The other two return "not enabled" instead of pretending to be a crew (Ch31).
- pgvector, Redis, S3, Langfuse, PDF parsing, full cron syntax, and a separate worker fleet: Postgres, local files, in-app cosine, and the in-process cron worker are enough to run locally.

## Consequence

`npm test` is the release gate for the new path. It does not call Anthropic. The old runner is not covered by that gate.
