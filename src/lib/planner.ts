import Anthropic from "@anthropic-ai/sdk";
import { SUPPORTED_TOOLKITS } from "@/lib/toolkits";

export type AgentPlan = {
  name: string;
  description: string;
  toolkits: string[];
  schedule: "daily" | "hourly" | "event";
  trigger_summary: string;
  steps: string[];
  instructions: string;
};

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

const SYSTEM = `You design automation agents for Agently, a platform where non-technical users automate their work.
An agent connects to the user's real tools (via managed OAuth) and runs on a schedule or event trigger.

Rules:
- Choose toolkits ONLY from the supported list provided in the user message. Never invent tools.
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
        content: `Requested changes to this plan:
"""
${feedback.slice(0, 1000)}
"""
Apply these changes and output the complete updated plan. Keep everything the user didn't ask to change.`,
      },
    ],
  });
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("planner returned no text");
  return JSON.parse(text.text) as AgentPlan;
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
  return JSON.parse(text.text) as AgentPlan;
}
