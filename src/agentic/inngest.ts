import { randomUUID } from "node:crypto";
import { Inngest } from "inngest";
import { Command } from "@langchain/langgraph";
import { parkedHoldPause } from "./holds";
import { modelFor } from "./model-choice";
import { openMeteredRun } from "./run-guard";
import { getAgenticGraph, threadConfig } from "./runtime";
import { readInterrupt } from "./graph";
import type { Hold } from "./types";

export const inngest = new Inngest({ id: "personal-assistant" });

type RunEvent = {
  threadId: string;
  userId: string;
  text?: string;
  runId?: string;
};

/**
 * Durable turn. The API route still runs the graph directly so the page streams
 * without this worker. Set AGENTIC_RUNTIME=inngest to enqueue turns here.
 * Ask, approval, and connect waits use waitForEvent so a redeploy does not lose them.
 */
export const agenticScheduleTick = inngest.createFunction(
  { id: "agentic-schedule-tick", triggers: [{ cron: "*/10 * * * *" }] },
  async ({ step }) =>
    step.run("due-schedules", async () => {
      const { runDueChatSchedules } = await import("./schedule-runner");
      return runDueChatSchedules(new Date());
    })
);

export const agenticTurn = inngest.createFunction(
  { id: "agentic-chat-turn", retries: 2, triggers: [{ event: "agentic/run.requested" }] },
  async ({ event, step }) => {
    const data = event.data as RunEvent;
    const runId = data.runId || `inngest:${data.threadId}:${randomUUID()}`;
    const opened = await openMeteredRun(data.userId, runId, "inngest", !data.runId);
    if (!opened.ok) return { status: "error", answer: opened.message, pause: null };
    try {
    let view = await step.run("invoke", async () => {
      const { graph } = await getAgenticGraph(undefined, opened.meter);
      const config = threadConfig(data.threadId);
      const modelId = (await modelFor(data.userId, data.threadId, process.env, opened.plan)) ?? "";
      const result = await graph.invoke(
        {
          messages: [{ role: "user", content: data.text ?? "" }],
          userId: data.userId,
          goal: data.text ?? "",
          threadId: data.threadId,
          modelId,
          plan: opened.plan,
          startedAt: Date.now(),
          activeMs: 0,
          touchedAt: Date.now(),
          status: "running",
          toolCalls: 0,
          approaches: [],
          trace: [],
          ledger: [],
          verifyRetries: 0,
          pending: null,
        },
        config
      );
      return publicResult(result);
    });
    let guard = 0;
    while (view.pause && guard < 15) {
      guard += 1;
      const name = view.pause.kind === "approval" ? "agentic/approval.resolved" : view.pause.kind === "connect" ? "agentic/connect.resolved" : "agentic/ask.answered";
      const incoming = await step.waitForEvent(`wait-${guard}`, {
        event: name,
        timeout: view.pause.kind === "approval" ? "72h" : "7d",
        match: "data.threadId",
      });
      view = await step.run(`resume-${guard}`, async () => {
        const { graph } = await getAgenticGraph(undefined, opened.meter);
        const resume = incoming?.data ?? (view.pause?.budget
          ? { id: view.pause.id, decision: "stop", text: "stop" }
          : { id: view.pause?.id, decision: "reject", declined: true, text: "The wait expired." });
        const result = view.pause?.via === "hold"
          ? await graph.invoke(
              { resolution: resume, finalAnswer: "", status: "running", verifyRetries: 0 },
              threadConfig(data.threadId)
            )
          : await graph.invoke(new Command({ resume }), threadConfig(data.threadId));
        return publicResult(result);
      });
    }
    return view;
    } finally {
      await opened.release();
    }
  }
);

function publicResult(result: { __interrupt__?: { value: unknown }[]; finalAnswer?: string; status?: string; holds?: Hold[] }) {
  const pause = parkedHoldPause(result.holds, readInterrupt(result));
  return {
    status: result.status ?? (pause ? pause.kind : "done"),
    answer: result.finalAnswer ?? "",
    pause,
  };
}
