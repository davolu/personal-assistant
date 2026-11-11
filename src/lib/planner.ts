import Anthropic from "@anthropic-ai/sdk";
import { SUPPORTED_TOOLKITS, toolkitComposioSlug } from "@/lib/toolkits";

export type AgentPlan = {
  name: string;
  description: string;
  toolkits: string[];
  schedule: "daily" | "hourly" | "event";
  trigger_summary: string;
  steps: string[];
  instructions: string;
  limitations?: string[];
  procedure?: { tool: string; purpose: string }[];
};

// ---- Real tool catalog (so plans are grounded in what the apps can actually do) ----
const catalogCache = new Map<string, string>();
const slugCache = new Map<string, Set<string>>();

// Raw slug set per toolkit — used by the save-time procedure validator.
export async function toolkitToolSlugs(toolkit: string): Promise<Set<string>> {
  const cached = slugCache.get(toolkit);
  if (cached) return cached;
  try {
    const slug = toolkitComposioSlug(toolkit).toLowerCase();
    const res = await fetch(`https://backend.composio.dev/api/v3/tools?toolkit_slug=${slug}&limit=99`, {
      headers: { "x-api-key": process.env.COMPOSIO_API_KEY || "" },
    });
    const json = (await res.json()) as { items?: { slug: string }[] };
    const set = new Set((json.items ?? []).map((t) => t.slug));
    if (set.size > 0) slugCache.set(toolkit, set);
    return set;
  } catch {
    return new Set();
  }
}

async function toolkitCatalog(toolkit: string): Promise<string> {
  const cached = catalogCache.get(toolkit);
  if (cached !== undefined) return cached;
  try {
    const slug = toolkitComposioSlug(toolkit).toLowerCase();
    const res = await fetch(`https://backend.composio.dev/api/v3/tools?toolkit_slug=${slug}&limit=99`, {
      headers: { "x-api-key": process.env.COMPOSIO_API_KEY || "" },
    });
    const json = (await res.json()) as { items?: { slug: string; description?: string }[] };
    const lines = (json.items ?? [])
      .map((t) => `- ${t.slug}: ${(t.description || "").replace(/\s+/g, " ").slice(0, 90)}`)
      .join("\n");
    const entry = `${toolkit} — available operations:\n${lines || "(none found)"}`;
    catalogCache.set(toolkit, entry);
    return entry;
  } catch {
    return `${toolkit} — catalog unavailable right now.`;
  }
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short, catchy agent name (2-4 words)" },
    description: { type: "string", description: "One sentence describing what the agent does" },
    toolkits: {
      type: "array",
      items: { type: "string", enum: SUPPORTED_TOOLKITS },
      description: "The tools this agent needs, chosen ONLY from the supported list (1-4 tools)",
    },
    schedule: { type: "string", enum: ["daily", "hourly", "event"] },
    trigger_summary: {
      type: "string",
      description: "Plain-language description of when the agent runs, e.g. 'Every morning at 8am' or 'Whenever a new email arrives'",
    },
    steps: {
      type: "array",
      items: { type: "string" },
      description: "4-6 plain-language steps describing the workflow, written for a non-technical user",
    },
    instructions: {
      type: "string",
      description: "The operating playbook the agent will follow at runtime: what to check, what rules to apply, what to produce, when to ask the human. 100-200 words.",
    },
  },
  required: ["name", "description", "toolkits", "schedule", "trigger_summary", "steps", "instructions"],
  additionalProperties: false,
} as const;

const GROUNDED_SCHEMA = {
  ...PLAN_SCHEMA,
  properties: {
    ...PLAN_SCHEMA.properties,
    limitations: {
      type: "array",
      items: { type: "string" },
      description:
        "ONLY one-time setup actions the USER must do before the agent can run (e.g. 'Create a design template with a text placeholder'). Each phrased as a short imperative action. Empty whenever the agent can achieve the goal without user setup. NEVER explanations of API behavior or internal workflow details.",
    },
    procedure: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tool: {
            type: "string",
            description: "Exact operation slug from the catalog (or WEB_RESEARCH for built-in research)",
          },
          purpose: {
            type: "string",
            description:
              "What this call does AND how its inputs come from earlier steps' outputs, e.g. 'export the design created in step 2; poll until the job returns the image URL'",
          },
        },
        required: ["tool", "purpose"],
        additionalProperties: false,
      },
      description:
        "The COMPLETE ordered tool execution sequence for one run, including polling/status calls and the final outbound action. Every content hand-off between steps must be explicit. This is the runtime agent's exact path — missing a step here means the agent skips it.",
    },
  },
  required: [...PLAN_SCHEMA.required, "limitations", "procedure"],
} as const;

const GROUND_SYSTEM = `You are a feasibility checker for AgentDock automation plans.
You are given a draft plan and the REAL list of API operations available for its chosen apps.
Silently revise the plan so every step is actually achievable with the listed operations (plus the built-in web research: web search, news search, read any URL — always available). The user should just see a plan that works — never API talk.

THE RUNTIME YOUR PLAN RUNS ON (write for it, never against it):
- One agent executes the whole job in a single pass of at most ~12 tool calls. It cannot pause, wait for a human, or resume later. NEVER write steps like "wait for approval" or "present for review" — the platform has a built-in approval gate that holds outbound actions automatically when the user enables "ask me first". The playbook and procedure must simply DO the final action (send/post/publish).
- Built-in web research tools are always available (use the slug WEB_RESEARCH in the procedure for them).
- Async operations (export jobs, merge jobs, upload jobs) need their status-poll call as an explicit separate step.
- The agent follows the "procedure" literally, in order. Anything not in it tends to be skipped; anything vague gets improvised badly. Spell out where each step's input comes from (an ID, URL, or content produced by an earlier step).

Rules:
- If a step relies on a capability that does NOT exist in the listed operations, rewrite the workflow onto the best achievable path that still reaches the user's goal (e.g. "export the design as an image, then post that image"). Do this silently — the user doesn't need to know the detour.
- Be especially skeptical of content creation: an operation that creates an EMPTY design/document/page is not the same as producing a finished one with the user's content in it. Verify an operation exists to get the user's actual content INTO the thing (autofill, body text parameter, cell values) and route the workflow through it.
- "limitations" is ONLY for one-time setup the USER must personally do before the agent can work (create a template with placeholders, upgrade a plan, create a folder). Phrase each as one short friendly action with why in a few words. If the agent can reach the goal without user setup, leave it EMPTY. Never put API explanations, workflow details, or reassurances there.
- If the user's message says a setup step is already DONE (they created the template/board/folder and maybe named it), treat that resource as existing: do NOT list it in limitations, and make sure the instructions playbook references it by the exact name or detail they gave.
- Keep steps in plain language — never put raw operation names in steps or description. Use operation names only inside the instructions playbook, where they help the runtime agent pick correctly.
- Drop toolkits that turn out to be useless for the job; never add ones that aren't needed.
- Keep the plan's spirit: same goal, same tone. The instructions playbook must spell out the achievable path precisely so the runtime agent doesn't rediscover dead ends.
- The "procedure" is the heart of the plan: the complete ordered list of exact operation slugs for one run, chosen from the catalog by reading each operation's description carefully. Include research, creation, content-insertion, polling, retrieval AND the final outbound action. If the catalog offers no operation to accomplish a load-bearing step (e.g. no way to insert text into a design), do NOT paper over it with a hopeful step — reroute the workflow or add the user setup that makes a real path exist (template + autofill).`;

// Second pass: check the draft against what the chosen apps' APIs can really do.
export async function groundPlan(idea: string, draft: AgentPlan): Promise<AgentPlan> {
  if (draft.toolkits.length === 0) return { ...draft, limitations: [] };
  const client = new Anthropic();
  const catalogs = await Promise.all(draft.toolkits.map(toolkitCatalog));
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 3000,
    system: GROUND_SYSTEM,
    output_config: { format: { type: "json_schema", schema: GROUNDED_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `What the user wants:
"""
${idea.slice(0, 2000)}
"""

Draft plan:
${JSON.stringify(draft)}

${catalogs.join("\n\n").slice(0, 14000)}

Output the verified plan.`,
      },
    ],
  });
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("grounding returned no text");
  return JSON.parse(text.text) as AgentPlan;
}

const SYSTEM = `You design automation agents for AgentDock, a platform where non-technical users automate their work.
An agent connects to the user's real tools (via managed OAuth) and runs on a schedule or event trigger.

Rules:
- Choose toolkits ONLY from the supported list provided in the user message. Never invent tools.
- Every agent also has BUILT-IN web research (web search, news search, read any URL) that needs no connection — so research/lookup steps never require a toolkit. Pick toolkits only for where data lives or actions happen (email, sheets, CRM, chat). Plans that research the web and act in one app are great.
- Prefer the fewest tools that accomplish the job (1-3 is ideal).
- Steps must be plain language a non-technical user instantly understands — no jargon, no API talk.
- Never add "wait for approval" or "present for review" steps — the platform has a built-in approval gate that holds outbound actions (sends, posts, replies) for the user automatically. Plans just do the action; mention in the description that the user can enable "ask me first" if they want review.
- The instructions field is the agent's runtime playbook: concrete, specific, decisive. Write it in second person ("You are...", "Check...", "Draft...").
- If the idea is impossible with the supported tools, pick the closest achievable version and make the description honest about what it does.`;

export async function refinePlan(idea: string, current: AgentPlan, feedback: string): Promise<AgentPlan> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: PLAN_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Supported tools: ${SUPPORTED_TOOLKITS.join(", ")}

What the user wants to automate:
"""
${idea.slice(0, 2000)}
"""`,
      },
      { role: "assistant", content: JSON.stringify(current) },
      {
        role: "user",
        content: `Message from the user about this plan:
"""
${feedback.slice(0, 1000)}
"""
Apply it and output the complete updated plan. Keep everything the user didn't ask to change.
If the user reports they completed a setup step (created a template, folder, board…), remove it from the remaining setup and bake every concrete detail they gave (names, links, preferences) into the instructions playbook so the agent uses exactly that resource at runtime.`,
      },
    ],
  });
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("planner returned no text");
  const draft = JSON.parse(text.text) as AgentPlan;
  try {
    return await groundPlan(`${idea}\n\nLatest user note: ${feedback.slice(0, 500)}`, draft);
  } catch (err) {
    console.error("refine grounding failed (serving ungrounded draft)", err);
    return draft;
  }
}

export async function generatePlan(idea: string): Promise<AgentPlan> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 2048,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: PLAN_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `Supported tools: ${SUPPORTED_TOOLKITS.join(", ")}

What the user wants to automate:
"""
${idea.slice(0, 2000)}
"""`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("planner returned no text");
  const draft = JSON.parse(text.text) as AgentPlan;
  // Ground the draft in the real tool catalog — plans must only promise what
  // the chosen apps' APIs can actually do.
  try {
    return await groundPlan(idea, draft);
  } catch (err) {
    console.error("plan grounding failed (serving ungrounded draft)", err);
    return draft;
  }
}
