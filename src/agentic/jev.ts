import type { HintLabel, TraceStep, VerifyReport } from "./types";

const CLAIM = /\b(i sent|i've sent|i deleted|i paid|i transferred|i charged|i submitted)\b/i;

export function heuristicVerify(input: { answer: string; trace: TraceStep[] }): VerifyReport {
  const grounded = input.trace.some((step) => step.ok && step.effect === "external" && !step.denied && !step.queued);
  const ungrounded = CLAIM.test(input.answer) && !grounded;
  if (!input.answer.trim() || ungrounded) {
    return {
      score: 0,
      label: "fails",
      ungrounded,
      feedback: ungrounded
        ? "The answer claims a send, delete, or payment that is not in the tool trace."
        : "The answer is empty.",
    };
  }
  return { score: 1, label: "meets", ungrounded: false, feedback: "The answer addresses the request and stays within the trace." };
}

export function createJevCritic(opts?: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined> }) {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const env = opts?.env ?? process.env;
  return {
    async score(input: { request: string; answer: string; trace: TraceStep[] }): Promise<VerifyReport> {
      const fallback = heuristicVerify(input);
      const key = env.TYPESAFE_API_KEY;
      if (!key) return fallback;
      const state = {
        request: input.request,
        answer: input.answer,
        trace: input.trace.map((step) => ({ tool: step.tool, ok: step.ok, effect: step.effect, error: step.error ?? "" })),
      };
      const body = await jev(fetchImpl, env, key, state, {
        satisfies: {
          type: "score",
          instructions: "How well does the final answer satisfy the user's request? Ignore style.",
          criteria: ["The answer misses the request", "The answer only partly addresses the request", "The answer satisfies the request"],
        },
        ungrounded: {
          type: "noul",
          instructions:
            "Does the answer claim that a message was sent, something was deleted, a payment was made, or a form was submitted, when the tool trace does not show that successful action?",
        },
      });
      if (!body) return fallback;
      const raw = typeof body.answers?.satisfies?.score === "number" ? body.answers.satisfies.score : 2;
      const label = raw < 0.5 ? "fails" : raw < 1.5 ? "partial" : "meets";
      const ungrounded = typeof body.answers?.ungrounded?.noul === "number" ? body.answers.ungrounded.noul > 0.5 : fallback.ungrounded;
      const score = Math.max(0, Math.min(1, raw / 2));
      return {
        score,
        label,
        ungrounded,
        feedback: ungrounded
          ? "Verifier: the answer claims an action the tool trace does not show."
          : `Verifier: ${label} (score ${score.toFixed(2)}).`,
      };
    },
    async hint(input: { request: string; tool: string; result: string }): Promise<HintLabel> {
      const key = env.TYPESAFE_API_KEY;
      if (!key) return "unsure";
      const body = await jev(fetchImpl, env, key, { request: input.request, tool: input.tool, result: input.result.slice(0, 2000) }, {
        moved: {
          type: "choice",
          instructions: "Did this tool result move the task forward? Pick unsure when the signal is weak.",
          criteria: {
            progress: "The result clearly moves the task forward",
            empty: "The call worked but found nothing",
            error: "The call failed",
            "wrong tool": "This was the wrong tool for the task",
            "needs user": "The user has to connect, approve, or answer before more progress",
            unsure: "Not enough signal to say",
          },
        },
      });
      const choice = body?.answers?.moved?.choice;
      if (choice === "progress" || choice === "empty" || choice === "error" || choice === "wrong tool" || choice === "needs user" || choice === "unsure") {
        return choice;
      }
      return "unsure";
    },
  };
}

type JevBody = {
  answers?: {
    satisfies?: { score?: number };
    ungrounded?: { noul?: number };
    moved?: { choice?: string };
  };
};

async function jev(
  fetchImpl: typeof fetch,
  env: Record<string, string | undefined>,
  key: string,
  state: unknown,
  questions: Record<string, unknown>
): Promise<JevBody | null> {
  const base = (env.TYPESAFE_BASE_URL || "https://api.typesafe.ai").replace(/\/$/, "");
  try {
    const res = await fetchImpl(`${base}/v1/systemone`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "jev-1.14.0", state, questions }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as JevBody;
  } catch {
    return null;
  }
}
