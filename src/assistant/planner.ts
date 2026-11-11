import type { Plan, PlanStep } from "./types";
import { asRecord, parseModelJson } from "./util";

const INTENTS = new Set(["chat", "act", "answer_from_docs"]);
const DELEGATES = new Set(["research", "email", "coding"]);

/** Code validates the planner's JSON before any tool runs (Ch8, Ch13). */
export function parsePlan(raw: string): { ok: true; plan: Plan } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = parseModelJson(raw);
  } catch {
    return { ok: false, error: "plan_not_json" };
  }
  const obj = asRecord(value);
  let intent = String(obj.intent ?? "");
  if (!INTENTS.has(intent) && typeof obj.reply === "string" && obj.reply.trim()) intent = "chat";
  if (!INTENTS.has(intent)) return { ok: false, error: "bad_intent" };
  const success = String(obj.success ?? "").trim() || (intent === "chat" ? "help the user" : "");
  if (!success) return { ok: false, error: "missing_success" };
  const rawSteps = obj.steps === undefined && intent === "chat" ? [] : obj.steps;
  if (!Array.isArray(rawSteps)) return { ok: false, error: "bad_steps" };
  if (rawSteps.length > 8) return { ok: false, error: "too_many_steps" };
  const steps: PlanStep[] = [];
  for (const step of rawSteps) {
    if (typeof step === "string" && step.trim()) {
      steps.push({ id: `s${steps.length + 1}`, goal: step.trim(), toolQuery: step.trim() });
      continue;
    }
    const s = asRecord(step);
    const id = String(s.id ?? "").trim() || `s${steps.length + 1}`;
    const goal = String(s.goal ?? "").trim();
    const toolQuery = String(s.toolQuery ?? goal).trim();
    if (!goal) return { ok: false, error: "bad_step" };
    const delegate = s.delegate === undefined ? undefined : String(s.delegate);
    if (delegate !== undefined && !DELEGATES.has(delegate)) return { ok: false, error: "bad_delegate" };
    steps.push({
      id,
      goal,
      toolQuery,
      ...(delegate ? { delegate: delegate as PlanStep["delegate"] } : {}),
    });
  }
  if (intent === "act" && steps.length === 0) return { ok: false, error: "act_needs_steps" };
  return { ok: true, plan: { intent: intent as Plan["intent"], success, steps } };
}

export type ActTurn = { done: boolean; reply: string; calls: { tool: string; args: Record<string, unknown> }[] };

export function parseAct(raw: string): { ok: true; act: ActTurn } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = parseModelJson(raw);
  } catch {
    return { ok: false, error: "act_not_json" };
  }
  const obj = asRecord(value);
  const calls: ActTurn["calls"] = [];
  if (obj.calls !== undefined) {
    if (!Array.isArray(obj.calls)) return { ok: false, error: "bad_calls" };
    for (const call of obj.calls) {
      const c = asRecord(call);
      const tool = String(c.tool ?? "").trim();
      if (!tool) return { ok: false, error: "bad_call" };
      calls.push({ tool, args: asRecord(c.args) });
    }
  }
  return { ok: true, act: { done: Boolean(obj.done), reply: String(obj.reply ?? ""), calls } };
}
