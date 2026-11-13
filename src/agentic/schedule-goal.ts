/** A schedule goal is the instruction for every run. Cadence numbers are never a goal. */

export const SCHEDULE_GOAL_ERROR = "Say what this should do each run.";

const GOAL_MAX = 4000;

export function normalizedGoal(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** True when the string is only a number, such as an hours field copied into the goal. */
export function isPurelyNumeric(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value);
}

export function validScheduleGoal(value: unknown): string {
  const clean = normalizedGoal(value);
  if (!clean || isPurelyNumeric(clean)) return "";
  return clean.slice(0, GOAL_MAX);
}

export function goalNeedsRepair(value: unknown): boolean {
  return validScheduleGoal(value) === "";
}

type ChatMessage = { role?: string; content?: unknown };

export function transcriptForGoal(messages: ChatMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    const text = messageText(message.content).replace(/\s+/g, " ").trim();
    if (!text || text.startsWith("Summary of earlier") || text.startsWith("Verifier:") || text.startsWith("This is a fresh scheduled run")) continue;
    const who = message.role === "assistant" ? "Assistant" : "User";
    lines.push(`${who}: ${text.slice(0, 1500)}`);
  }
  return lines.join("\n").slice(0, 12000);
}

/** The first thing the user typed. Used only when the model call fails. */
export function firstUserMessage(messages: ChatMessage[]): string {
  for (const message of messages) {
    if (message.role !== "user" || typeof message.content !== "string") continue;
    const text = message.content.replace(/\s+/g, " ").trim();
    if (!text || text.startsWith("Hold update:") || text.startsWith("This is a fresh scheduled run") || text.startsWith("Summary of earlier")) continue;
    return text.slice(0, GOAL_MAX);
  }
  return "";
}

/**
 * Ask the model for one standing instruction. If that call throws, or the reply
 * is empty or purely numeric, use the first user message instead.
 */
export async function distillScheduleGoal(messages: ChatMessage[], complete: (transcript: string) => Promise<string>): Promise<string> {
  const transcript = transcriptForGoal(messages);
  const fallback = validScheduleGoal(firstUserMessage(messages));
  if (!transcript) return fallback;
  try {
    const goal = validScheduleGoal(await complete(transcript));
    if (goal) return goal;
  } catch {
    return fallback;
  }
  return fallback;
}

export async function repairScheduleRows(
  store: {
    listBroken(userId: string | null, limit: number): Promise<{ userId: string; id: string; threadId: string; goal: string }[]>;
    setGoal(userId: string, id: string, goal: string, previous: string): Promise<unknown>;
  },
  userId: string | null,
  loadMessages: (userId: string, threadId: string) => Promise<ChatMessage[]>,
  complete: (userId: string, threadId: string, transcript: string) => Promise<string>
): Promise<number> {
  const rows = await store.listBroken(userId, 20);
  let fixed = 0;
  for (const row of rows) {
    if (!goalNeedsRepair(row.goal)) continue;
    let messages: ChatMessage[] = [];
    try {
      messages = await loadMessages(row.userId, row.threadId);
    } catch {
      messages = [];
    }
    const goal = await distillScheduleGoal(messages, (transcript) => complete(row.userId, row.threadId, transcript));
    if (!validScheduleGoal(goal) || goal === row.goal) continue;
    const updated = await store.setGoal(row.userId, row.id, goal, row.goal);
    if (updated) fixed += 1;
  }
  return fixed;
}

export function visibleRunOutput(lastSummary: string, live: { status: string; summary: string } | null): { output: string; pending: string } {
  if (live?.status === "running") return { output: lastSummary, pending: live.summary && live.summary !== lastSummary ? live.summary : "" };
  if (lastSummary) return { output: lastSummary, pending: "" };
  return { output: live?.summary ?? "", pending: "" };
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const bits: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as { type?: string; text?: string; content?: unknown };
    if (record.type === "text" && record.text) bits.push(record.text);
    else if (record.type === "tool_result") {
      const inner = typeof record.content === "string" ? record.content : messageText(record.content);
      if (inner) bits.push(inner);
    }
  }
  return bits.join("\n");
}
