/**
 * Close an unfinished fenced or inline code span so a streaming token
 * does not swallow the rest of the message as a code block.
 */
export function stabilizeStreamingMarkdown(source: string): string {
  let text = source ?? "";
  const fences = text.match(/```/g)?.length ?? 0;
  if (fences % 2 === 1) text += "\n```";

  const outsideFences = text.replace(/```[\s\S]*?```/g, "");
  const inlineTicks = outsideFences.match(/(?<!`)`(?!`)/g)?.length ?? 0;
  if (inlineTicks % 2 === 1) text += "`";
  return text;
}

const SAFE_URL = /^(https?:|mailto:)/i;

/** Drop javascript:, data:, and other non-navigation URLs. */
export function safeMarkdownUrl(url: string): string {
  const value = url.trim();
  if (SAFE_URL.test(value)) return value;
  return "";
}
