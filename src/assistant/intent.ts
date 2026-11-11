import type { ChatMessage, Plan, Proposal } from "./types";

export type RequestMode = "clear_action" | "needs_clarification" | "brief";

const VIDEO_BRIEF =
  "a video agent that can create videos, characters and image from script given it and it will be 3-5 minutes in length and can also edit videos with prompts";

/** The owner approved the plan card. Execution may start. */
export function isPlanApproval(text: string): boolean {
  return /^(looks good(?:\s*,?\s*go)?|go ahead|do it|yes,?\s*go|start the plan|ship it)\b/i.test(text.trim());
}

/**
 * Code decides whether this turn may call tools.
 * A pasted brief or an open question stays in the planner. A concrete request may act.
 */
export function classifyRequest(text: string, history: ChatMessage[] = []): RequestMode {
  const trimmed = text.trim();
  const priorPlan = [...history].reverse().find((message) => message.role === "assistant" && /Proposed plan:/i.test(message.content));
  if (priorPlan && isPlanApproval(trimmed)) return "clear_action";
  if (priorPlan && !isClearAction(trimmed)) return "needs_clarification";
  if (isBrief(trimmed)) return "brief";
  if (isClearAction(trimmed)) return "clear_action";
  if (isOpenEnded(trimmed)) return "needs_clarification";
  return "clear_action";
}

export function isBrief(text: string): boolean {
  if (/\bagent\b/i.test(text)) return true;
  const ands = text.match(/\band\b/gi)?.length ?? 0;
  return text.trim().length > 220 && ands >= 2;
}

function isClearAction(text: string): boolean {
  const trimmed = text.trim();
  if (/^(hi|hello|hey|thanks|thank you|good morning)\b/i.test(trimmed) && trimmed.length < 80) return true;
  if (/^(what|who|when|where|why|how)\b/i.test(trimmed) && trimmed.length < 160 && !/\bagent\b/i.test(trimmed)) return true;
  return [
    /\b(send|email|e-mail|mail)\b/i,
    /\b(search|look up|lookup)\b/i,
    /\b(every day|once a day|daily|each morning|hourly|every week)\b/i,
    /\b(what time|remember|note that|save a note)\b/i,
    /\bconnect\b/i,
    /\b(summary of my|my (gmail|zoho|slack|notion|calendar|instagram|canva))\b/i,
  ].some((pattern) => pattern.test(trimmed));
}

function isOpenEnded(text: string): boolean {
  return /\b(help me|not sure|something|whatever|figure out|i have an idea|can you build)\b/i.test(text);
}

export function fallbackProposal(text: string): Proposal {
  const video = /\b(video|videos)\b/i.test(text);
  const understanding = video
    ? "You want an assistant that turns a script into a short video, with characters and images, around 3–5 minutes, and that can also edit a video from a written prompt."
    : `You want help with this, and it is not a single action yet: ${text.replace(/\s+/g, " ").trim().slice(0, 180)}`;
  const questions = video
    ? [
        "Will you paste the script, or should the assistant write it from a short brief?",
        "Is 3–5 minutes the length of every video, or only some of them?",
        "What should the first version do: generate from a script, keep characters consistent, or edit an existing video?",
      ]
    : [
        "Who is this for, and where should the result show up?",
        "What does a finished version look like the first time it runs?",
        "What should it never do without asking you first?",
      ];
  const steps = video
    ? [
        "Confirm the audience, the inputs, and the first video you want",
        "Choose where scripts, characters, and finished videos live",
        "Build only the first step after you approve this plan",
      ]
    : [
        "Restate the outcome in one sentence and confirm it",
        "List the apps and inputs it needs",
        "Do the first small step only after you approve this plan",
      ];
  return { understanding, questions, steps, status: "proposed" };
}

export function formatProposal(proposal: Proposal): string {
  const questions = proposal.questions.slice(0, 3).map((question, index) => `${index + 1}. ${question}`).join("\n");
  const steps = proposal.steps.slice(0, 6).map((step, index) => `${index + 1}. ${step}`).join("\n");
  return [
    `Here's what I think you mean: ${proposal.understanding}`,
    `Before I use any tools, I need a few details:\n${questions}`,
    `Proposed plan:\n${steps}`,
    `Reply with changes, or say "Looks good, go" and I'll start.`,
  ].join("\n\n");
}

export function planFromProposal(proposal: Proposal): Plan {
  const steps = proposal.steps.slice(0, 6).map((step, index) => ({
    id: `s${index + 1}`,
    goal: step,
    toolQuery: step,
  }));
  return {
    intent: "act",
    success: proposal.understanding || "carry out the approved plan",
    steps: steps.length ? steps : [{ id: "s1", goal: "carry out the approved plan", toolQuery: proposal.understanding || "approved plan" }],
  };
}

export const SAMPLE_VIDEO_BRIEF = VIDEO_BRIEF;
