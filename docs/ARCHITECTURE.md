# Personal assistant architecture

> Designed with Agentic Architect (A-Z of Agentic AI), against the approved Miro board "Personal AI Assistant: Hybrid Architecture". Diagram: `architecture.mmd` and `architecture-preview.svg`. Machine-readable twin: `architecture.json`. The board source SVGs are the owner's approved picture; this spec is the build contract.

The Miro skill checker warns that 37 nodes is a lot for one frame. The approved board is already that wide, so the diagram stays one system instead of being split into a diagram that hides boxes.

## 1. Goal and scope

- **User and journey:** A person types to one assistant. It plans, calls tools across their apps, and streams an answer. If the next action would send, delete, or pay, the chat shows the exact call and waits.
- **Done means:** The turn ends with a named stop reason. External effects either did not run, or ran once after a single-use approval whose digest matches the executed args. The trace supports the reply.
- **Supported requests:** Chat with no tools. Clock, notes, and uploaded text. Search the public web with no user OAuth. Work in any Composio toolkit: connected apps run, and an unconnected app returns a connect link. Scheduled routines (hourly, daily, weekly) and event routines fed by Composio webhooks.
- **Non-goals:** A mobile client, push or email notifications, voice, bundled official MCP servers, our own Google/Slack OAuth screens, a multi-agent crew, pgvector, Redis, S3, Langfuse, PDF parsing, and auto-approval of send, delete, or pay. Each of these is an extension point in the map below, not a silent deletion.

Assumptions, because the board was already approved: one owner per login, Claude is the main model, Composio hosts long-tail OAuth, and v1 runs locally as this Next.js app plus Postgres.

## 2. Autonomy (Ch1, Ch24)

Level: **hybrid**. A bounded agent proposes tool calls. Code decides what is allowed.

| Decision | Chosen by | Why |
|---|---|---|
| What the user is asking | Model, as a JSON plan that code validates | The path is not known up front (Ch24) |
| Which model answers | Code, the router | Cost and fallback are not a prompt choice (Ch52) |
| Which tools are visible this step | Code, the registry | Fail closed (Ch29) |
| Whether a call runs, holds, or is denied | Code, the effect gate | Irreversible work is not a model decision (Ch48) |
| The exact external call | The owner, on one approval card | Approve the action, not the agent (Ch49) |
| When to stop | Code, budgets and named stop reasons | (Ch14) |

## 3. Pattern decisions

| # | Decision | Choice | Reason | Chapter | Rejected alternative |
|---|---|---|---|---|---|
| D1 | Autonomy | Hybrid bounded agent with approvals | A chat cannot be a fixed script, and send/delete/pay cannot be free | Ch1, Ch24 | Free tool loop with no gate; fully scripted procedures for every chat |
| D2 | Workflow vs agent | Plan, then a bounded ReAct loop | Steps are proposed, then checked, then walked | Ch24 | One unconstrained ReAct loop; a procedure walker for open chat |
| D3 | Reasoning | Plan-execute on top, ReAct inside a step, code checks claims | The plan is checkable. "I sent it" is checked against the trace | Ch13 | A model critic as the only verifier |
| D4 | Agents | One assistant, plus one read-only research worker | Research is the only named context-isolation case | Ch31 | A crew of email, coding, and research agents |
| D5 | Tools | MCP hub, builtin server, Composio adapter, fail-closed allowlist | MCP is the standard. Composio is the long tail. The host authorizes | Ch11, Ch29 | Giving the model the raw Composio catalog |
| D6 | Knowledge | RAG over uploaded text, hybrid keyword plus optional vectors | Private docs change. App facts stay in tools | Ch17 | Embedding the whole tool catalog |
| D7 | Memory | Short-term messages, semantic facts, episodes, checkpoints, effect ledger | Separate stores, separate owners | Ch18, Ch19 | One prose memory blob that also grants permission |
| D8 | Guardrails | Edge, model schema, allowlist, effect gate, output filter | Each layer decides on its own | Ch48 | A regex on the prompt as the only control |
| D9 | HITL | Exact, single-use, 72h approvals. Edit re-hashes | The card is the boundary where state changes | Ch49 | An "approve the agent" toggle, or auto mode for sends |
| D10 | Reliability | Timeouts, idempotency keys, transient-only retries, webhook dedupe | A lost response must not send twice | Ch14, Ch53 | Retry every error |
| D11 | Evals | Golden set in `evals/golden.json`, release gate PROMOTE/HOLD | Safety is zero-tolerance | Ch41-45 | Manual checking only |
| D12 | Deploy | Next.js on one machine, Postgres for jobs and vectors | The owner can run it locally. Redis and a worker fleet wait | Ch51-52 | LangGraph plus Celery plus Vault on day one |

## 4. Components

| Layer | Component | Kind | Responsibility | Owner | Code |
|---|---|---|---|---|---|
| Clients | Web chat | actor | Type, stream, approve | user | `src/app/chat` |
| Clients | Mobile client | actor | Same HTTP API, no app yet | extension | — |
| Edge | Streaming gateway | interface | SSE of tool events, then the filtered reply | platform | `src/app/api/assistant/chat` |
| Edge | Auth and sessions | interface | better-auth | platform | `src/lib/auth.ts` |
| Edge | Input filters | guardrail | Empty, length, jailbreak phrases | platform | `src/assistant/filters.ts` |
| Edge | Rate and cost limits | guardrail | 20 turns / 10 min, daily USD ceiling | platform | `src/assistant/cost.ts` |
| Edge | Webhook verifier | guardrail | HMAC and id dedupe | platform | `src/app/api/webhooks/composio` |
| Core | Orchestrator | orchestrator | Plan, loop, budgets, stop reasons | platform | `src/assistant/orchestrator.ts` |
| Core | Planner | agent | Classify a brief, a clarification, or a clear action, then a JSON plan | platform | `src/assistant/intent.ts`, `src/assistant/planner.ts` |
| Core | ReAct loop | agent | Propose calls, observe, stop | platform | `src/assistant/orchestrator.ts` |
| Core | Research sub-agent | agent | Read-only, one hop | platform | `src/assistant/subagent.ts` |
| Core | Tool registry | orchestrator | Score tools for this step, cap 8 | platform | `src/assistant/registry.ts` |
| Core | Model router | agent | Strong, cheap, embed, fallback | platform | `src/assistant/router.ts` |
| Core | Context manager | orchestrator | Drop oldest turns first | platform | `src/assistant/context.ts` |
| Tools | MCP client hub | tool | One call path, timeouts, envelopes | platform | `src/assistant/hub.ts` |
| Tools | Builtin MCP | tool | Clock, notes, docs, remember | platform | `src/assistant/builtin.ts` |
| Tools | Official MCP | tool | HTTP client. Servers are not bundled | extension | `src/assistant/mcp.ts` |
| Tools | Composio | tool | Search and execute for the long tail | platform | `src/lib/composio-provider.ts` |
| Tools | Token vault | data | AES-GCM for direct MCP tokens | platform | `src/assistant/vault.ts` |
| Tools | Connections | data | Which apps are linked, and scopes | platform | `Connection` |
| Policy | Effect gate | guardrail | Execute, hold, or deny | platform | `src/assistant/policy.ts` |
| Policy | Approval decision | human | Approve, edit, or reject one call | user | chat approval card |
| Policy | Output filter | guardrail | Redact secrets, rewrite false send claims | platform | `src/assistant/filters.ts` |
| Background | Task queue and worker | orchestrator | Postgres jobs, in-process worker | platform | `src/assistant/queue.ts` |
| Memory | Retrieval | data | Owner-scoped keyword plus cosine | platform | `src/assistant/memory.ts` |
| Data | Postgres | data | Users, chats, tasks, jobs | platform | `prisma/schema.prisma` |
| Data | Checkpoints | data | Resume after approval | platform | `AssistantTask.checkpoint` |
| Data | File store | data | Local disk. S3 is the extension | platform | `src/assistant/files.ts` |
| Observability | Traces, cost, audit, evals | observability | Spans, USD, audit rows, golden gate | platform | `trace.ts`, `cost.ts`, `evals/` |

## 5. Data flows

| From | To | What flows | Trusted? |
|---|---|---|---|
| Web chat | Streaming gateway | The user's text | No |
| Gateway | Orchestrator | Session, screened text, quota | After the edge checks |
| Planner | ReAct loop | A validated plan | The JSON schema is checked |
| ReAct loop | Effect gate | `{tool, args}` | A proposal, not a permission |
| Effect gate | MCP hub | Allowlisted reads and internal writes | Yes, for that call |
| Effect gate | Approval card | External calls | Held |
| Tools, docs, events | Model | Wrapped untrusted blocks | No. Data, not instructions |
| Output filter | Chat | The reply, then SSE chunks | After secret and claim checks |

## 6. Trust boundaries and checkers (Ch46, Ch62)

| Boundary | What crosses | Checker (code) | On failure |
|---|---|---|---|
| Browser to API | Chat, approval, upload | better-auth session and owner filter | 401 or 404 |
| User text to model | The turn | `screenInput` | `INPUT_BLOCKED`, no model call |
| Spend | The turn | `allowSpend`, `allowRate` | `COST_BUDGET` or `RATE_LIMIT` |
| Webhook to queue | App payload | HMAC plus `acceptDelivery` | 401, or a no-op duplicate |
| Model to tool | Proposed call | Allowlist, then `gateDecision` | Denial observation, or a hold |
| Tool text to model | Results | `wrapUntrusted` | Still data. The gate ignores it |
| Approval to effect | One call | `canResolve` plus compare-and-set | `DENIED`, `WAITING_EXPIRED`, no call |
| User A to user B | Facts, notes, files, effects | `userId` on every query | The other user's rows are invisible |

## 7. Tool contracts (Ch11, Ch48)

One envelope: `{ ok, data }` or `{ ok: false, error: { code, message } }`. Timeouts become `TIMEOUT`. Unknown names become `NOT_ALLOWLISTED` and the provider is not called.

| Tool | Effect | Scope | Idempotency |
|---|---|---|---|
| `builtin.clock.now` | read | none | n/a |
| `builtin.notes.search` | read | this user | n/a |
| `builtin.notes.add` | write_internal | this user | key on `(user, args)` |
| `builtin.docs.search` | read | this user's chunks | n/a |
| `builtin.memory.remember` | write_internal | a fact of at most 200 chars | content is data, not a permission |
| `mcp.<server>.<tool>` | from the name | that server | key on the proposal |
| Composio slug | from the name. `SEND`, `DELETE`, `PAY`, and the other external verbs hold | the user's Composio account | key on the proposal |

The name wins over a provider that labels a send as a read. Unknown names deny. There is no shell and no `eval`.

## 8. State, memory and checkpoints (Ch18, Ch19)

| Store | Holds | Owner scope | Retention | Deletion |
|---|---|---|---|---|
| `Message` | Short-term conversation | user | with the conversation | cascade |
| `MemoryFact` | Semantic facts | user | until the account is deleted | cascade |
| `Episode` | Task summary and a trace-derived lesson | user | with the account | cascade |
| `DocChunk` | RAG chunks, optional embedding | user and source id | replaced when the same file is uploaded again | cascade |
| `AssistantTask.checkpoint` | Plan, step cursor, trace | that task | until the task settles | with the user |
| `EffectLedger` | Idempotent tool results | user and key | with the user | cascade |
| `AssistantApproval` | Exact held call | user | 72h, then expired | cascade |
| `TokenSecret` | Direct MCP tokens, ciphertext only | user and provider | until disconnect | cascade |
| `AuditEvent` | Approvals, denials, expiries | user | with the account | cascade |

A lesson is built from the stop reason and the tool names, so it cannot invent a send the trace does not have. A model-written lesson is an extension.

## 9. Human approval points (Ch49)

| Action | Approver | Evidence shown | Expiry | On timeout |
|---|---|---|---|---|
| External effect (send, delete, pay, and the other external verbs) | The owner | Tool name and the full JSON args | 72h | No effect. Status `expired`. Stop `WAITING_EXPIRED` |
| Edited args | The owner, by saving the edited JSON | The edited payload | same row | The new digest is what runs |
| Reject | The owner | same card | — | Stop `REJECTED`. No call |

Reads and internal writes (notes, drafts, remember) run without a card. v1 has no auto-approve switch.

## 10. Failure handling (Ch14, Ch53)

- Budgets: 8 tool calls, 20,000 tokens, the daily USD ceiling, 4 model turns per step, 15s per tool.
- Stop reasons: `MODEL_ANSWER`, `ABSTAIN`, `STEP_BUDGET`, `TOKEN_BUDGET`, `COST_BUDGET`, `RATE_LIMIT`, `WAITING_APPROVAL`, `WAITING_EXPIRED`, `DENIED`, `REJECTED`, `INPUT_BLOCKED`, `FAILED`, `MODEL_UNAVAILABLE`, `LOOP_DETECTED`.
- Retries: jobs retry transient errors with backoff, up to 3 attempts. A 400 from the model does not fall back. 429 and 5xx fall back once, to OpenAI, when that key exists.
- The same tool and args twice is allowed. The third identical call stops with `LOOP_DETECTED`.
- Escalation: the chat shows the stop reason. Expired approvals are audited.

## 11. Evaluation and observability (Ch41-45)

- Dimensions: task success, safety, abstention, efficiency. Safety floor is 100%.
- Golden set: 25 cases in `evals/golden.json`, version `2026-11-11`. The runner is `src/assistant/golden.ts`.
- Tracing: one span list per turn. Attribute strings are redacted and truncated before they are stored.
- Release gate: `npm test` and `npm run evals`. `PROMOTE` only when every case passes. A failed safety case is `HOLD`.

## 12. Cost and latency (Ch52)

A chat turn is a plan call on Claude Sonnet plus act calls on Sonnet. Research uses the same client. Summaries and classification route to Haiku when a caller asks for those roles. The daily ceiling defaults to $2 per user (`ASSISTANT_DAILY_BUDGET_USD`). Prices in `cost.ts` are a budget table, not an invoice. Levers: tool-result truncation, context dropping, the step budget, and the cheap model for side roles.

The reply is filtered before it is streamed. Raw model tokens are not sent to the browser, because the output filter has to see the whole reply first (Ch48). The UI still receives the approved text in small chunks, plus live tool events.

## 13. Risks and owners (Ch46, Ch59)

| Risk | Impact x likelihood | Prevent / detect / correct | Owner |
|---|---|---|---|
| Injection in an email steers a send | high x medium | Gate ignores content; send holds / audit / reject the card | platform |
| Composio or MCP outage | medium x medium | Envelope errors, job retry if transient / traces / stop `MODEL_UNAVAILABLE` or `TOOL_FAILED` | founder |
| Rubber-stamp approvals | medium x medium | Full payload on the card / audit sample / no auto mode | product |
| Memory poisoning | medium x low | Facts cannot change the gate; owner filter / reset by deleting the account | platform |
| "Create issue" is an internal write and can be visible to others | medium x low | Documented residual. Promote those verbs to external if it shows up in traces | founder |

## 14. Open questions

- When a connected app's create/comment verbs should move from internal write to external.
- Whether the owner wants an explicit, written opt-in for auto-running a named tool. It is not the default.
- When the embedding count justifies pgvector, and when the job rate justifies Redis.

## Miro board map

`src/assistant/miro.ts` is the same map, and a test fails if a box id disappears.

| Id | Box | Status | Where it lives |
|---|---|---|---|
| A1 | Web chat | implemented | `src/app/chat` |
| A2 | Mobile app | extension | Same HTTP API. No React Native client |
| A3 | Notifications | partial | In-app status. Push and email are an extension |
| A4 | Approval cards | implemented | Chat approval card |
| B1 | Streaming gateway | implemented | `POST /api/assistant/chat` |
| B2 | Auth and sessions | implemented | better-auth |
| B3 | Rate limits and quotas | implemented | `cost.ts` |
| B4 | Webhook ingress | implemented | `/api/webhooks/composio` |
| C1 | Orchestrator | implemented | `orchestrator.ts` |
| C2 | Planner | implemented | `planner.ts` |
| C3 | ReAct loop | implemented | `orchestrator.ts` |
| C4 | Sub-agents | partial | Research only. Email and coding are extension points on the same port |
| C5 | Tool registry | implemented | `registry.ts` |
| C6 | Model router | implemented | `router.ts` |
| C7 | Context manager | implemented | `context.ts` |
| T1 | MCP client hub | implemented | `hub.ts` |
| T2 | Official MCP servers | partial | HTTP client. GitHub, Notion, Slack, Drive, Linear, Stripe are not bundled |
| T3 | Custom MCP | implemented | Builtin server, plus `MCP_SERVERS` |
| T4 | Composio | implemented | Catalog search across toolkits, plus no-auth web search, in `composio-provider.ts` |
| T5 | Auth and token vault | partial | AES-GCM vault. Own OAuth consent is an extension. Composio hosts the long tail |
| T6 | Connection manager | implemented | `Connection` and `/apps` |
| E1–E4 | External apps | external | Reached through Composio or MCP |
| G1 | HITL gate | implemented | `policy.ts` |
| G2 | Input filters | implemented | `filters.ts` |
| G3 | Injection defense | implemented | `wrapUntrusted`. The gate does not read content |
| G4 | Output filters | implemented | `composeReply`, `screenOutput` |
| K1 | Event triggers | partial | Webhook enqueues event routines |
| K2 | Scheduler | implemented | builtin.routines plus /api/assistant/cron. Presets are hourly, daily, and weekly |
| K3 | Task queue | implemented | `assistant_job` and `queue.ts` |
| K4 | Workers | partial | In-process worker on the cron tick. A separate fleet is an extension |
| L1 | Strong models | implemented | Claude Sonnet |
| L2 | Cheap models | implemented | Claude Haiku |
| L3 | Embeddings | partial | OpenAI when a key is set, otherwise keywords |
| L4 | Fallback | implemented | OpenAI after Anthropic 429/5xx |
| M1 | Short-term memory | implemented | `Message` |
| M2 | Semantic memory | partial | `MemoryFact` and optional JSON vectors |
| M3 | Episodic memory | implemented | `Episode` |
| M4 | RAG | partial | Plain text. PDF parsing is an extension |
| S1 | Secrets vault | partial | Env for app keys, AES column for user tokens |
| S2 | Postgres | implemented | Prisma |
| S3 | Vector DB | partial | In-app cosine. pgvector is the index extension |
| S4 | Redis and object storage | partial | Postgres queue and local files. Redis and S3 are extensions |
| P1 | Least privilege | partial | Scopes are stored. Composio owns the consent screen |
| P2 | Per-user isolation | implemented | `userId` on every assistant query |
| P3 | Audit log | implemented | `AuditEvent` |
| P4 | Encryption | partial | AES-GCM at rest. Key rotation is an extension |
| O1 | Tracing | implemented | `trace.ts` |
| O2 | Cost tracking | implemented | `cost.ts` and `AssistantTask.costUsd` |
| O3 | Evals | implemented | `evals/golden.json` |
| O4 | Logs and alerts | partial | `evaluateAlerts`. Pager delivery is an extension |

## What changed relative to the old runner

The previous product walked a saved procedure for a hired template agent, and it could auto-run external tools when the agent was in auto mode. This chat does not use that walker. The template catalog is still in the repo. Its runner is unchanged. New chat, routines, and event routines go through `src/assistant`. See `docs/ADR-001-hybrid-architecture.md`.
