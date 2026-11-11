/** The plan card button sends this sentence. It is a UI protocol, not a guess about the request. */
export function isPlanApproval(text: string): boolean {
  return /^(looks good(?:\s*,?\s*go)?|go ahead|do it|yes,?\s*go|start the plan|ship it)\b/i.test(text.trim());
}

/** Shows the builder button when the user is describing an agent to build. */
export function isBrief(text: string): boolean {
  return /\bagent\b/i.test(text);
}
