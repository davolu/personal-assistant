# Build plan: personal assistant

> Generated from `docs/ARCHITECTURE.md` and `architecture.json`. If the code needs to differ, change the spec first.

## 0. Ground rules

- The model proposes. Authorization, budgets, and side effects live in `src/assistant`, which does not import Next or Prisma.
- No secrets in code, prompts, logs, or git. `.env.example` lists them.
- Routes in `src/app/api/assistant` stay thin. `src/lib/assistant-runtime.ts` is the adapter.

## 1. Baseline

- [x] Next.js app, Prisma, Postgres, `.env.example`, docker compose
- [x] Model client with timeout, one fallback on 429/5xx, and a clear error when no key is set
- [x] Tests run with no network and no database

## 2. Contracts

- [x] Tool envelope, effect class, action digest
- [x] Plan and act JSON validated before tools run
- [x] Stop reasons listed in the spec

## 3. Vertical slice

The journey: the user asks to send an email, the gate holds, the owner approves, the call runs once.

- [x] Session check on the chat route
- [x] Orchestrator with step, token, and cost budgets
- [x] Allowlist fails closed
- [x] Effect gate denies unknown tools and holds external ones
- [x] Approval is exact, single-use, expiring, and resumable from a checkpoint
- [x] Idempotency key so a second resolve does not call the tool again
- [x] Trace spans with redacted attributes

## 4. Remaining components

| Component | Task | Test | Done |
|---|---|---|---|
| Input filter | Jailbreak phrases and length | `core.test.ts` | [x] |
| Injection wrap | Tool text is data | golden `injection-held` | [x] |
| Output filter | Secrets and false send claims | golden `output-secret` | [x] |
| Registry | Overlap only, else empty | `core.test.ts` | [x] |
| Router | Strong vs cheap vs fallback | `core.test.ts` | [x] |
| Context manager | Drop oldest turns | `core.test.ts` | [x] |
| Memory | Owner filter and hybrid score | `core.test.ts` and `owner-isolation` | [x] |
| Research sub-agent | Read-only hop | golden `research-readonly` | [x] |
| Email and coding sub-agents | Port exists, not enabled | golden `coding-extension` | [x] |
| MCP client | List and call through a transport | `core.test.ts` | [x] |
| Composio adapter | Search and execute behind the hub | wired, live call needs a key | [x] |
| Vault | AES-GCM round trip | `core.test.ts` | [x] |
| Queue and scheduler | Retry transient, skip duplicates, due routines | `core.test.ts` | [x] |
| Webhook dedupe | Second id is a no-op | `core.test.ts` | [x] |
| Evals | Golden file and release gate | `release.test.ts` | [x] |
| Mobile, push, pgvector, Redis, S3, own OAuth, PDF | Documented extension points | Miro map test | [x] |

## 5. Safety tests

- [x] Injection in tool or event text does not execute a send
- [x] Unapproved send does not call the provider
- [x] Expired and replayed approvals are rejected
- [x] A fact from another user is not retrieved
- [x] Step budget, loop, cost budget, and rate limit return the named stop reason

## 6. Evaluation harness

- [x] `evals/golden.json` with stable ids
- [x] Deterministic runner, no model trials required for the gate
- [x] `npm run evals` prints PROMOTE or HOLD and exits 1 on HOLD

## 7. Operations

- [x] `docker-compose.yml`, `.env.example`, README quick start
- [x] Cron route `/api/assistant/cron` with the existing bearer secret
- [ ] Pager delivery for `evaluateAlerts` (the detector exists; delivery is an extension)
- [ ] A hosted runbook beyond the README

## 8. Traceability

- [x] Every Miro id is in `src/assistant/miro.ts` and the spec table
- [x] Every trust boundary in the spec has a checker named in section 6
- [x] The approval hold is in `gateDecision`, not only in the prompt
- [x] `architecture.json` passes `spec_to_miro.py --check`
