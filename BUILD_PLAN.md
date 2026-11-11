# Build plan: AgentDock — grounded plan-execute agent platform

> Generated from `ARCHITECTURE.md` / `architecture.json`. Rule: code must match the architecture. If implementation needs to differ, update the spec and the diagram first, then this plan.

## 0. Ground rules
- The model proposes, the system disposes: authorization, budgets and side effects live in plain, tested code (Ch4, Ch48).
- No secrets in code, prompts, logs or state; `.env.example` documents them (Ch5).
- Business logic in framework-agnostic functions (`src/lib/*`), routes stay thin (Ch21).
- Every task below has a deterministic check that proves it (unit script or live verification), written alongside.

## 1. Baseline (Ch5) — already in place
- [x] Repo, pinned dependencies, `.env.example`
- [x] Provider seam: Composio SDK + OpenAI/Anthropic behind `runner.ts`; model ladder; structured logs in RunLog
- [x] Smoke: missing-config errors surface; secrets only via env

## 2. Contracts (Ch8, Ch11)
- [x] Edge: better-auth session + owner-checked queries on every route
- [x] **Action proposal type**: `{tool, args, effectClass}` produced for every proposed call, consumed only by the gate
- [x] **Effect classes**: `read | write_internal | external | unknown` — total classifier over tool slugs with an override table; `unknown` never auto-executes
- [x] One result envelope: Composio `{successful,data,error}` normalized in `traceFromContent`

## 3. Vertical slice: scheduled procedure run with held external effect (Ch63)
The journey: cron tick → due agent with a structured procedure → code walks steps → model fills arguments → external step held → owner approves → run resumes and completes.
- [x] Edge: cron auth (Bearer), webhook signature — adding webhook-id dedupe
- [x] Orchestrator: **procedure walker** — one step at a time, step-scoped tools, bounded recovery loop, step/token budgets, named stop reasons (`DONE, FAILED, STEP_BUDGET, TOKEN_BUDGET, LOOP_DETECTED, WAITING_APPROVAL, DENIED, SKIPPED_PRECONDITION`)
- [x] Model steps: step executor (args for current step), recovery (bounded), reflector (existing)
- [x] Tools: per-step allowlist (the step's tool + poll partner) in procedure mode; agent-toolkit allowlist in recovery; fails closed on unknown tool names
- [x] Policy gate: deny-by-default effect function called before **every** dispatch, both modes
- [x] HITL: approval holds the exact call, **expires in 72h**, single-use; **approve executes the call and resumes remaining steps from the checkpoint**
- [x] Checkpoint: `RunLog.state` after every completed step; resume never repeats a completed side effect
- [x] Trace: per-call entries with ok/args/error (existing), plus stopReason

## 4. Remaining components (one task per spec component)
| Component (spec) | Task | Check that proves it | Done |
|---|---|---|---|
| Procedure validator | save route validates every step slug against live catalog | saving a plan with a fake slug → 400 naming the step | [x] |
| Webhook verifier | add webhook-id dedupe table | same event id twice → second is a no-op | [x] |
| Effect policy gate | `src/lib/effects.ts` classifier + decision | red-team script: send/post/delete always `external`; unknown never executes | [x] |
| Approvals inbox | expiry + resume semantics | expired approval → rejected; approve → remaining steps ran | [x] |
| Run checkpoints | `RunLog.state` cursor | waiting run has state; resumed run completes without re-running step 1 | [x] |
| Trigger router | cron sweep also expires stale approvals | stale approval → status expired, run FAILED/WAITING_EXPIRED | [x] |
| Golden replay harness | drift detected at run time (SKIPPED_PRECONDITION names the vanished tool); weekly re-validation deferred | procedure run with missing tool fails fast, named | [x] (runtime) |
| Audit log | approvals/denials/expiries queryable | resolve writes result + resolvedAt; denials logged | [x] (Approval rows) |
| Run traces | span-like trace per run | existing `RunLog.trace` | [x] |

## 5. Safety tests (Ch47, Ch50) — deterministic, in `scripts/redteam.mjs`
- [x] Injection fixtures: email/web text containing instructions → classifier/gate unaffected (gate decisions depend only on tool slug + agent policy, never content)
- [x] Unapproved external attempt in ask-first mode → held, zero side effects
- [x] Expired / already-resolved approval → rejected, no execution
- [x] Unknown-class tool → never auto-executed in any mode
- [x] Budget exhaustion → correct stop reason, honest FAILED summary

## 6. Evaluation harness (Ch41-45)
- [x] Golden-from-reality: successful training runs stay pinned as proven procedures (existing); drift check re-validates them against the live catalog without executing side effects
- [x] Safety dimension: audit query — zero external effects without a matching approval for ask-first agents
- [x] Release gate (manual for now): run `scripts/redteam.mjs` + typecheck before deploy; both must pass

## 7. Operations (Ch51-55)
- [x] Vercel deploy, env via dashboard, crons configured
- [ ] Runbook note in README: resume semantics, approval expiry, drift flags
- [x] Cost levers: nano-first model routing, result truncation, run quotas

## 8. Traceability check (before calling it done)
- [x] Every component in `architecture.json` maps to code and a check (table above)
- [x] Every trust boundary has a checker in code
- [x] Every HITL point is enforced in code, not just in a prompt
- [x] Diagram unchanged — implementation matches the spec
