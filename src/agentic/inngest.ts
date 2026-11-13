import { Inngest } from "inngest";
import { Command } from "@langchain/langgraph";
import { getAgenticGraph, threadConfig } from "./runtime";
import { readInterrupt } from "./graph";

export const inngest = new Inngest({ id: "personal-assistant" });

type RunEvent = {
  threadId: string;
  userId: string;
  text?: string;
};

/**
 * Durable turn. The API route still runs the graph directly so the page streams
 * without this worker. Set AGENTIC_RUNTIME=inngest to enqueue turns here.
 * Ask, approval, and connect waits use waitForEvent so a redeploy does not lose them.
 */
export const agenticTurn = inngest.createFunction(
  { id: "agentic-chat-turn", retries: 2, triggers: [{ event: "agentic/run.requested" }] },
  async ({ event, step }) => {
    const data = event.data as RunEvent;
    let view = await step.run("invoke", async () => {
      const { graph } = await getAgenticGraph();
      const config = threadConfig(data.threadId);
      const result = await graph.invoke(
        {
          messages: [{ role: "user", content: data.text ?? "" }],
          userId: data.userId,
          goal: data.text ?? "",
          threadId: data.threadId,
          startedAt: Date.now(),
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
        const { graph } = await getAgenticGraph();
        const resume = incoming?.data ?? { decision: "reject", declined: true, text: "The wait expired." };
        const result = await graph.invoke(new Command({ resume }), threadConfig(data.threadId));
        return publicResult(result);
      });
    }
    return view;
  }
);

function publicResult(result: { __interrupt__?: { value: unknown }[]; finalAnswer?: string; status?: string }) {
  const pause = readInterrupt(result) as { kind?: string } | null;
  return {
    status: result.status ?? (pause ? pause.kind : "done"),
    answer: result.finalAnswer ?? "",
    pause: pause ? { kind: pause.kind ?? "ask" } : null,
  };
}
