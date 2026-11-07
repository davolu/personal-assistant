import { Composio } from "@composio/core";
import { AnthropicProvider } from "@composio/anthropic";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getBot } from "@/lib/agents";
import { toolkitComposioSlug } from "@/lib/toolkits";

const MAX_STEPS = 8;

type AgentSpec = { name: string; instructions: string; toolkits: string[] };

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
      .slice(1) // step 1 is the connect step, not runtime work
      .map((s, i) => `${i + 1}. ${s}`)
      .join("\n")}\n\nWhy this matters: ${bot.why}`,
  };
}

const RULES = `
Operating rules:
- Use your tools to actually do the work now. Do not describe what you would do — do it.
- Never send messages to third parties directly; when output is a message to someone other than your owner, create a draft instead and say so.
- If a tool fails, try a sensible alternative once, then report the failure plainly.
- Finish with a 1-3 sentence plain-language summary of what you did, written for your owner's activity log.`;

/** Execute one agent run end-to-end. Returns the RunLog id. */
export async function executeRun(hiredAgentId: string, trigger: "schedule" | "manual" | "event") {
  const agent = await prisma.hiredAgent.findUniqueOrThrow({
    where: { id: hiredAgentId },
    include: { user: { include: { connections: true } } },
  });

  const log = await prisma.runLog.create({
    data: { userId: agent.userId, agentId: agent.id, trigger, status: "running" },
  });

  const fail = async (msg: string) => {
    await prisma.runLog.update({
      where: { id: log.id },
      data: { status: "error", summary: msg.slice(0, 500), finishedAt: new Date() },
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
    const kickoff = `Run your job now. Current date/time: ${new Date().toUTCString()}. When finished, reply with only the short summary for the activity log.`;

    const provider = (process.env.RUNNER_PROVIDER || "openai").toLowerCase();
    const summary =
      provider === "anthropic"
        ? await runAnthropic(agent.userId, slugs, system, kickoff)
        : await runOpenAI(agent.userId, slugs, system, kickoff);

    await prisma.$transaction([
      prisma.runLog.update({
        where: { id: log.id },
        data: { status: "success", summary: summary.slice(0, 500), finishedAt: new Date() },
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
async function runOpenAI(userId: string, toolkits: string[], system: string, kickoff: string) {
  const composio = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  const openai = new OpenAI();
  const tools = (await composio.tools.get(userId, {
    toolkits,
    limit: 40,
  })) as OpenAI.Chat.Completions.ChatCompletionTool[];

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
      return msg.content ?? "Done.";
    }
    // Composio executes the calls against the user's connected accounts and
    // returns ready-made tool messages (toolkit versions handled internally).
    const toolMessages = (await composio.provider.handleToolCalls(
      userId,
      completion
    )) as OpenAI.Chat.Completions.ChatCompletionToolMessageParam[];
    for (const tm of toolMessages) {
      messages.push({
        ...tm,
        content: typeof tm.content === "string" ? tm.content.slice(0, 12000) : tm.content,
      });
    }
  }
  return "Reached the step limit for this run — partial work may have been completed.";
}

// ---------- Anthropic provider path ----------
async function runAnthropic(userId: string, toolkits: string[], system: string, kickoff: string) {
  const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY,
    provider: new AnthropicProvider(),
  });
  const anthropic = new Anthropic();
  const tools = (await composio.tools.get(userId, { toolkits, limit: 40 })) as Anthropic.Tool[];

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
      return text && text.type === "text" ? text.text : "Done.";
    }

    // Composio executes the calls and returns Anthropic-format tool_result blocks.
    const raw = (await composio.provider.handleToolCalls(userId, response)) as unknown;
    const blocks = (Array.isArray(raw) ? raw : [raw]) as Anthropic.ToolResultBlockParam[];
    const results = blocks.map((b) => ({
      ...b,
      content: typeof b.content === "string" ? b.content.slice(0, 12000) : b.content,
    }));
    messages.push({ role: "user", content: results });
  }
  return "Reached the step limit for this run — partial work may have been completed.";
}
