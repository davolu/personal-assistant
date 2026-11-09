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
};

// ---- Real tool catalog (so plans are grounded in what the apps can actually do) ----
const catalogCache = new Map<string, string>();

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
        "ONLY one-time setup actions the USER must do before the agent can run (e.g. 'Create a Canva template with a text placeholder for the verse'). Each phrased as a short imperative action. Empty whenever the agent can achieve the goal without user setup. NEVER explanations of API behavior or internal workflow details.",
    },
  },
  required: [...PLAN_SCHEMA.required, "limitations"],
} as const;

const GROUND_SYSTEM = `You are a feasibility checker for AgentDock automation plans.
You are given a draft plan and the REAL list of API operations available for its chosen apps.
Silently revise the plan so every step is actually achievable with the listed operations (plus the built-in web research: web search, news search, read any URL — always available). The user should just see a plan that works — never API talk.

Rules:
- If a step relies on a capability that does NOT exist in the listed operations, rewrite the workflow onto the best achievable path that still reaches the user's goal (e.g. "export the design as an image, then post that image"). Do this silently — the user doesn't need to know the detour.
- Be especially skeptical of content creation: an operation that creates an EMPTY design/document/page is not the same as producing a finished one with the user's content in it. Verify an operation exists to get the user's actual content INTO the thing (autofill, body text parameter, cell values) and route the workflow through it.
- "limitations" is ONLY for one-time setup the USER must personally do before the agent can work (create a template with placeholders, upgrade a plan, create a folder). Phrase each as one short friendly action with why in a few words. If the agent can reach the goal without user setup, leave it EMPTY. Never put API explanations, workflow details, or reassurances there.
- If the user's message says a setup step is already DONE (they created the template/board/folder and maybe named it), treat that resource as existing: do NOT list it in limitations, and make sure the instructions playbook references it by the exact name or detail they gave.
- Keep steps in plain language — never put raw operation names in steps or description. Use operation names only inside the instructions playbook, where they help the runtime agent pick correctly.
- Drop toolkits that turn out to be useless for the job; never add ones that aren't needed.
- Keep the plan's spirit: same goal, same tone. The instructions playbook must spell out the achievable path precisely so the runtime agent doesn't rediscover dead ends.`;

// Second pass: check the draft against what the chosen apps' APIs can really do.
async function groundPlan(idea: string, draft: AgentPlan): Promise<AgentPlan> {
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
- Anything that sends external messages (emails to clients, posts, replies) must include a human-approval step.
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
