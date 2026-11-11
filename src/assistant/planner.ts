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
  const intent = String(obj.intent ?? "");
  if (!INTENTS.has(intent)) return { ok: false, error: "bad_intent" };
  const success = String(obj.success ?? "").trim();
  if (!success) return { ok: false, error: "missing_success" };
  if (!Array.isArray(obj.steps)) return { ok: false, error: "bad_steps" };
  if (obj.steps.length > 8) return { ok: false, error: "too_many_steps" };
  const steps: PlanStep[] = [];
  for (const step of obj.steps) {
    const s = asRecord(step);
    const id = String(s.id ?? "").trim();
    const goal = String(s.goal ?? "").trim();
    const toolQuery = String(s.toolQuery ?? goal).trim();
    if (!id || !goal) return { ok: false, error: "bad_step" };
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
