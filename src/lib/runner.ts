import { Composio } from "@composio/core";
import { AnthropicProvider } from "@composio/anthropic";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { getBot } from "@/lib/agents";
import { toolkitComposioSlug } from "@/lib/toolkits";

const MAX_STEPS = 16;
const TOOLS_PER_TOOLKIT = 25;

type AgentSpec = { name: string; instructions: string; toolkits: string[] };
export type TraceEntry = { tool: string; ok: boolean; error?: string; args?: string };
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
- Work efficiently: batch independent tool calls together in one turn, and NEVER repeat a tool call you already made with the same arguments — reuse its earlier result.
- NEVER claim an action you did not perform with a tool call in this run. Only report actions whose tool call returned success, and include identifiers the tools returned (file names, IDs, links, draft IDs) as proof.
- NEVER pass placeholder or invented values (like "your-page-id", "<parent_id>", "example@email.com") into tool arguments. When a tool needs an ID — a page, database, folder, channel, contact — first discover the real one with a search/fetch/list tool. If nothing suitable exists, create the prerequisite first if a create tool allows it; otherwise report FAILED naming exactly what's missing.
- If a capability you need has no corresponding tool available, you must not pretend — report it as FAILED and name the missing capability.
- Never send messages to third parties directly; when output is a message to someone other than your owner, create a draft instead and say so.
- When a tool call fails, READ its error message, diagnose the cause, fix your arguments or switch to a better-suited tool, and retry — up to 2 corrected attempts per obstacle before moving on.
- If a resource your job needs doesn't exist yet (a database, page, folder, label, spreadsheet), CREATE it now with the available create tools, then continue the job. Do not give up because a prerequisite is missing.
- You have persistent memory across runs. Facts under "Memory from previous runs" are things you already learned — reuse them to skip rediscovery. BUT if a remembered value fails (404 / not found / permission error), it is STALE: discard it immediately, re-discover the real resource with search tools, and use the fresh value. Never retry a remembered value that just failed.
- Resource IDs have types: a page ID is not a database ID is not a folder ID. Use IDs only with tools matching their type, taking the type from the search/fetch result ("object" field or equivalent). If the structured container you need (database, sheet, folder) doesn't exist, create it under an accessible parent and continue.
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

/** Canonicalize tool arguments so cosmetic differences (whitespace, key order,
 * dashes stripped from UUIDs) can't dodge the duplicate-call guard. */
function canonicalArgs(raw: string): string {
  try {
    const sort = (v: unknown): unknown =>
      Array.isArray(v)
        ? v.map(sort)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)]))
          : typeof v === "string"
            ? v.replace(/-/g, "").toLowerCase()
            : v;
    return JSON.stringify(sort(JSON.parse(raw)));
  } catch {
    return raw.replace(/\s+/g, "");
  }
}

const REPEAT_NOTE =
  '\n\nHARNESS NOTE: You already made this exact call in this run and it FAILED with the result above. Do not retry it or variations of the same value. Change strategy now: discard the value you used, discover the real resource with a search/fetch tool, or create the missing prerequisite.';

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

/**
 * Fetch tools per toolkit (so one chatty toolkit can't crowd out the others),
 * then prioritize: discovery tools first (search/fetch/list — the model needs
 * these to find real IDs instead of inventing placeholders), actions second.
 */
type ToolFetcher = {
  tools: { get(userId: string, opts: { toolkits: string[]; limit: number }): Promise<unknown> };
};

const toolName = (t: unknown): string => {
  const o = t as { function?: { name?: string }; name?: string };
  return o.function?.name ?? o.name ?? "";
};

const toolScore = (name: string): number => {
  if (/(SEARCH|FETCH|LIST|QUERY|FIND|GET_)/.test(name)) return 3; // discovery
  if (/(CREATE|SEND|ADD|UPDATE|INSERT|DRAFT|UPLOAD|REPLY|APPEND|MOVE|LABEL)/.test(name)) return 2; // action
  return 1;
};

async function getToolsBalanced(composio: ToolFetcher, userId: string, toolkits: string[]) {
  const perToolkit = await Promise.all(
    toolkits.map((tk) =>
      composio.tools
        .get(userId, { toolkits: [tk], limit: 99 })
        .then((r) => (Array.isArray(r) ? r : []))
        .catch(() => [] as unknown[])
    )
  );
  return perToolkit.flatMap((tools) =>
    tools
      .map((t) => ({ t, score: toolScore(toolName(t)) }))
      .sort((a, b) => b.score - a.score || toolName(a.t).localeCompare(toolName(b.t)))
      .slice(0, TOOLS_PER_TOOLKIT)
      .map((x) => x.t)
  );
}

/** Execute one agent run end-to-end. Returns the RunLog id. */
export async function executeRun(hiredAgentId: string, trigger: "schedule" | "manual" | "event" | "training") {
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
    const memorySection = agent.memory
      ? `\n\nMemory from previous runs (facts you already learned — reuse them):\n${agent.memory}`
      : "";
    const system = `${spec.instructions}\n${RULES}${memorySection}`;
    const kickoff = `Run your job now. Current date/time: ${new Date().toUTCString()}. When finished, reply with only the DONE:/FAILED: summary for the activity log.`;

    const provider = (process.env.RUNNER_PROVIDER || "openai").toLowerCase();
    const result =
      provider === "anthropic"
        ? await runAnthropic(agent.userId, slugs, system, kickoff)
        : await runOpenAI(agent.userId, slugs, system, kickoff);
    const outcome = parseOutcome(result.text, result.trace);

    // Self-learning: distill this run into updated persistent memory.
    let memory = agent.memory;
    try {
      memory = await reflect(provider, agent.memory, spec.name, outcome, result.trace);
    } catch (err) {
      console.error("reflection error (non-fatal)", err);
    }

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
        data: { runsUsed: { increment: 1 }, lastRunAt: new Date(), memory },
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

// ---------- Self-learning reflection ----------
const REFLECT_PROMPT = `You maintain the persistent memory of an automation agent. Given its old memory and what happened in the latest run, output the UPDATED memory.

Keep it under 120 words, as plain bullet lines. Include ONLY durable, reusable knowledge:
- concrete resource facts discovered (database/page/folder/label IDs and names, so future runs skip re-searching)
- errors hit and the fix that worked (or should be tried next)
- anything tried that doesn't work, so it isn't repeated
Carry forward old facts that are still valid. If this run PROVED a stored fact wrong (an ID that 404'd, a resource that doesn't exist), DELETE that fact entirely — never keep it with a caveat — and record the verified replacement if one was discovered. Drop one-off details (specific email contents, dates). Output ONLY the memory text.`;

async function reflect(
  provider: string,
  oldMemory: string,
  agentName: string,
  outcome: { status: string; summary: string },
  trace: TraceEntry[]
): Promise<string> {
  const runReport = `Agent: ${agentName}
Old memory:
${oldMemory || "(empty)"}

Latest run outcome: ${outcome.status}
Summary: ${outcome.summary.slice(0, 600)}
Tool calls:
${trace.map((t) => `${t.ok ? "OK" : "FAILED"} ${t.tool}${t.error ? ` — ${t.error.slice(0, 120)}` : ""}${t.args ? ` args: ${t.args.slice(0, 120)}` : ""}`).join("\n") || "(none)"}`;

  if (provider === "anthropic") {
    const anthropic = new Anthropic();
    const res = await anthropic.messages.create({
      model: process.env.RUNNER_ANTHROPIC_MODEL || "claude-haiku-4-5",
      max_tokens: 300,
      system: REFLECT_PROMPT,
      messages: [{ role: "user", content: runReport }],
    });
    const text = res.content.find((b) => b.type === "text");
    return (text && text.type === "text" ? text.text : oldMemory).trim().slice(0, 1500);
  }
  const openai = new OpenAI();
  const res = await openai.chat.completions.create({
    model: process.env.RUNNER_OPENAI_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: REFLECT_PROMPT },
      { role: "user", content: runReport },
    ],
  });
  return (res.choices[0].message.content ?? oldMemory).trim().slice(0, 1500);
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
  const resultCache = new Map<string, string>();
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

    // Duplicate-call guard: identical (tool, args) calls return the cached
    // result instead of re-executing — breaks retry loops and saves steps.
    const fresh: typeof msg.tool_calls = [];
    const dupes: { id: string; key: string }[] = [];
    for (const tc of msg.tool_calls) {
      if (tc.type !== "function") continue;
      const key = `${tc.function.name}|${canonicalArgs(tc.function.arguments)}`;
      if (resultCache.has(key)) dupes.push({ id: tc.id, key });
      else fresh.push(tc);
    }

    // Composio executes the calls against the user's connected accounts.
    const toolMessages = fresh.length
      ? ((await composio.provider.handleToolCalls(userId, {
          ...completion,
          choices: [{ ...completion.choices[0], message: { ...msg, tool_calls: fresh } }],
        })) as OpenAI.Chat.Completions.ChatCompletionToolMessageParam[])
      : [];
    for (const d of dupes) {
      const cached = resultCache.get(d.key)!;
      const wasFailure = /"successful"\s*:\s*false|"error"/.test(cached);
      toolMessages.push({
        role: "tool",
        tool_call_id: d.id,
        content: wasFailure ? cached + REPEAT_NOTE : cached,
      });
    }

    const callById = new Map(
      msg.tool_calls
        .filter((tc) => tc.type === "function")
        .map((tc) => [tc.id, { name: tc.function.name, args: tc.function.arguments }])
    );
    for (const tm of toolMessages) {
      const call = callById.get(tm.tool_call_id);
      if (call && typeof tm.content === "string") {
        resultCache.set(`${call.name}|${canonicalArgs(call.args)}`, tm.content.slice(0, 12000));
      }
      trace.push({
        ...traceFromContent(call?.name ?? "unknown", tm.content),
        args: (call?.args ?? "").slice(0, 300),
      });
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
    const callById = new Map(toolUses.map((tu) => [tu.id, { name: tu.name, args: JSON.stringify(tu.input) }]));
    const results = blocks.map((b) => {
      const call = callById.get(b.tool_use_id);
      trace.push({
        ...traceFromContent(call?.name ?? "unknown", b.content),
        args: (call?.args ?? "").slice(0, 300),
      });
      return {
        ...b,
        content: typeof b.content === "string" ? b.content.slice(0, 12000) : b.content,
      };
    });
    messages.push({ role: "user", content: results });
  }
  return { text: "FAILED: reached the step limit for this run — partial work may have been completed.", trace };
}
