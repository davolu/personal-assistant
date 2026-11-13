import { createAgentDriver } from "./agent-model";
import { modelFor } from "./model-choice";
import { distillScheduleGoal } from "./schedule-goal";
import type { ContentBlock } from "./types";

const GOAL_SYSTEM = `You write the standing instruction for one scheduled run of a chat.
Read the conversation and reply with a single instruction that says what to do every time the schedule runs.
Include the targets and the details already settled in the chat.
Do not mention how often it runs, a clock time, or a timezone.
Reply with only that instruction.`;

export async function goalForChat(userId: string, threadId: string, messages: { role?: string; content?: unknown }[]): Promise<string> {
  return distillScheduleGoal(messages, (transcript) => completeGoalTranscript(userId, threadId, transcript));
}

export function completeGoalTranscript(userId: string, threadId: string, transcript: string): Promise<string> {
  return completeScheduleGoal(userId, threadId, transcript);
}

async function completeScheduleGoal(userId: string, threadId: string, transcript: string): Promise<string> {
  const modelId = await modelFor(userId, threadId);
  if (!modelId) throw new Error("No model is configured.");
  const driver = createAgentDriver();
  const turn = await withTimeout(
    driver.complete({
      system: GOAL_SYSTEM,
      messages: [{ role: "user", content: transcript || "The chat has no messages yet." }],
      tools: [],
      modelId,
    }),
    20_000
  );
  return turn.content.filter((block): block is Extract<ContentBlock, { type: "text" }> => block.type === "text").map((block) => block.text).join("\n");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The model took too long.")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
