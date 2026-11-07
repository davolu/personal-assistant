import { Composio } from "@composio/core";
import { AnthropicProvider } from "@composio/anthropic";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getBot } from "@/lib/agents";
import { toolkitComposioSlug } from "@/lib/toolkits";

const MAX_STEPS = 8;
const TOOLS_PER_TOOLKIT = 15;

type AgentSpec = { name: string; instructions: string; toolkits: string[] };
export type TraceEntry = { tool: string; ok: boolean; error?: string };
type LoopResult = { text: string; trace: TraceEntry[] };

async function resolveSpec(agent: { slug: string; name: string; userId: string }): Promise<AgentSpec | null> {
  if (agent.slug.startsWith("custom-")) {
    const custom = await prisma.customAgent.findFirst({
      where: { id: agent.slug.replace(/^custom-/, ""), userId: agent.userId },
    });
    if (!custom) return null;
    return {
      name: custom.name,
      toolkits: custom.toolkits,
      instructions: `${custom.instructions}\n\nWorkflow:\n${custom.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
    };
  }
  const bot = getBot(agent.slug);
  if (!bot) return null;
  return {
    name: bot.name,
    toolkits: bot.toolkits,
    instructions: `You are "${bot.name}" — ${bot.desc}.\n\nPlaybook:\n${bot.steps
      .slice(1)
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n")}\n\nWhy this matters: ${bot.why}`,
  };
}

const RULES = `
Operating rules:
- Use your tools to actually do the work now. Do not describe what you would do — do it.
- NEVER claim an action you did not perform with a tool call in this run. Only report actions whose tool call returned success, and include identifiers the tools returned (file names, IDs, links, draft IDs) as proof.
- If a capability you need has no corresponding tool available, you must not pretend — report it as FAILED and name the missing capability.
- Never send messages to third parties directly; when output is a message to someone other than your owner, create a draft instead and say so.
- If a tool fails, try a sensible alternative once, then report the failure plainly.
- Your final message MUST start with exactly "DONE:" if the job was completed via successful tool calls, or exactly "FAILED:" if not. Then a plain-language summary for your owner's activity log.`;

function parseOutcome(raw: string, trace: TraceEntry[]): { status: "success" | "error"; summary: string } {
  const text = raw.trim();
  if (/^FAILED:/i.test(text)) return { status: "error", summary: text.replace(/^FAILED:\s*/i, "") };
  if (/^DONE:/i.test(text)) {
    // DONE with zero successful tool calls is a hallucination — refuse to call it success.
    const anyOk = trace.some((t) => t.ok);
    if (!anyOk && trace.length === 0) {
      return { status: "error", summary: `Claimed done without using any tools — treated as failed. Claim was: ${text.replace(/^DONE:\s*/i, "")}` };
    }
    return { status: "success", summary: text.replace(/^DONE:\s*/i, "") };
  }
  const failed = /\b(unable to|failed|could not|couldn't|cannot complete|error with)\b/i.test(text);
  return { status: failed ? "error" : "success", summary: text };
}

/** Result content from Composio is JSON like {"data":...,"successful":true,...} */
function traceFromContent(tool: string, content: unknown): TraceEntry {
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    const ok = parsed?.successful !== false && !parsed?.error;
    return { tool, ok, ...(ok ? {} : { error: String(parsed?.error ?? "unknown error").slice(0, 200) }) };
  } catch {
    return { tool, ok: true };
  }
}

/** Fetch tools per toolkit so one chatty toolkit can't crowd out the others. */
type ToolFetcher = {
  tools: { get(userId: string, opts: { toolkits: string[]; limit: number }): Promise<unknown> };
};
async function getToolsBalanced(composio: ToolFetcher, userId: string, toolkits: string[]) {
  const perToolkit = await Promise.all(
    toolkits.map((tk) =>
      composio.tools
        .get(userId, { toolkits: [tk], limit: TOOLS_PER_TOOLKIT })
        .then((r) => (Array.isArray(r) ? r : []))
        .catch(() => [] as unknown[])
    )
  );
  return perToolkit.flat();
}

/** Execute one agent run end-to-end. Returns the RunLog id. */
export async function executeRun(hiredAgentId: string, trigger: "schedule" | "manual" | "event") {
  const agent = await prisma.hiredAgent.findUniqueOrThrow({
    where: { id: hiredAgentId },
    include: { user: { include: { connections: true } } },
  });

  const log = await prisma.runLog.create({
    data: { userId: agent.userId, agentId: agent.id, trigger, status: "running" },
  });

  const fail = async (msg: string, trace: TraceEntry[] = []) => {
    await prisma.runLog.update({
      where: { id: log.id },
      data: { status: "error", summary: msg.slice(0, 2000), trace, finishedAt: new Date() },
    });
    return log.id;
  };

  try {
    if (agent.user.runsUsed >= agent.user.runsQuota) {
      return await fail("Run skipped: monthly run limit reached. Upgrade or top up to resume.");
    }
    const spec = await resolveSpec(agent);
    if (!spec) return await fail("Agent definition not found.");

    const active = new Set(
      agent.user.connections.filter((c) => c.status === "active").map((c) => c.toolkit)
    );
    const missing = spec.toolkits.filter((t) => !active.has(t));
    if (missing.length > 0) {
      return await fail(`Run skipped: connect ${missing.join(", ")} first.`);
    }

    const slugs = spec.toolkits.map((t) => toolkitComposioSlug(t).toUpperCase());
    const system = `${spec.instructions}\n${RULES}`;
    const kickoff = `Run your job now. Current date/time: ${new Date().toUTCString()}. When finished, reply with only the DONE:/FAILED: summary for the activity log.`;

    const provider = (process.env.RUNNER_PROVIDER || "openai").toLowerCase();
    const result =
      provider === "anthropic"
        ? await runAnthropic(agent.userId, slugs, system, kickoff)
        : await runOpenAI(agent.userId, slugs, system, kickoff);
    const outcome = parseOutcome(result.text, result.trace);

    await prisma.$transaction([
      prisma.runLog.update({
        where: { id: log.id },
        data: {
          status: outcome.status,
          summary: outcome.summary.slice(0, 2000),
          trace: result.trace,
          finishedAt: new Date(),
        },
      }),
      prisma.hiredAgent.update({
        where: { id: agent.id },
        data: { runsUsed: { increment: 1 }, lastRunAt: new Date() },
      }),
      prisma.user.update({
        where: { id: agent.userId },
        data: { runsUsed: { increment: 1 } },
      }),
    ]);
    return log.id;
  } catch (err) {
    console.error("run error", err);
    return await fail(err instanceof Error ? err.message : String(err));
  }
}

// ---------- OpenAI provider path (default — cheapest) ----------
async function runOpenAI(userId: string, toolkits: string[], system: string, kickoff: string): Promise<LoopResult> {
  const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  const openai = new OpenAI();
  const tools = (await getToolsBalanced(
    composio,
    userId,
    toolkits
  )) as OpenAI.Chat.Completions.ChatCompletionTool[];

  const trace: TraceEntry[] = [];
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: kickoff },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const completion = await openai.chat.completions.create({
      model: process.env.RUNNER_OPENAI_MODEL || "gpt-4o-mini",
      messages,
      tools,
    });
    const msg = completion.choices[0].message;
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      return { text: msg.content ?? "Done.", trace };
    }

    // Composio executes the calls against the user's connected accounts.
    const toolMessages = (await composio.provider.handleToolCalls(
      userId,
      completion
    )) as OpenAI.Chat.Completions.ChatCompletionToolMessageParam[];

    const nameById = new Map(
      msg.tool_calls.filter((tc) => tc.type === "function").map((tc) => [tc.id, tc.function.name])
    );
    for (const tm of toolMessages) {
      trace.push(traceFromContent(nameById.get(tm.tool_call_id) ?? "unknown", tm.content));
      messages.push({
        ...tm,
        content: typeof tm.content === "string" ? tm.content.slice(0, 12000) : tm.content,
      });
    }
  }
  return { text: "FAILED: reached the step limit for this run — partial work may have been completed.", trace };
}

// ---------- Anthropic provider path ----------
async function runAnthropic(userId: string, toolkits: string[], system: string, kickoff: string): Promise<LoopResult> {
  const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY,
    provider: new AnthropicProvider(),
  });
  const anthropic = new Anthropic();
  const tools = (await getToolsBalanced(composio, userId, toolkits)) as Anthropic.Tool[];

  const trace: TraceEntry[] = [];
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: kickoff }];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await anthropic.messages.create({
      model: process.env.RUNNER_ANTHROPIC_MODEL || "claude-haiku-4-5",
      max_tokens: 2048,
      system,
      messages,
      tools,
    });
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );
    if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
      const text = response.content.find((b) => b.type === "text");
      return { text: text && text.type === "text" ? text.text : "Done.", trace };
    }

    const raw = (await composio.provider.handleToolCalls(userId, response)) as unknown;
    const blocks = (Array.isArray(raw) ? raw : [raw]) as Anthropic.ToolResultBlockParam[];
    const nameById = new Map(toolUses.map((tu) => [tu.id, tu.name]));
    const results = blocks.map((b) => {
      trace.push(traceFromContent(nameById.get(b.tool_use_id) ?? "unknown", b.content));
      return {
        ...b,
        content: typeof b.content === "string" ? b.content.slice(0, 12000) : b.content,
      };
    });
    messages.push({ role: "user", content: results });
  }
  return { text: "FAILED: reached the step limit for this run — partial work may have been completed.", trace };
}
