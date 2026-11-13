export type PreviewBlock = { label: string; text?: string; html?: string };

const ALLOWED = new Set(["a", "b", "blockquote", "br", "code", "div", "em", "h1", "h2", "h3", "h4", "hr", "i", "li", "ol", "p", "pre", "span", "strong", "table", "tbody", "td", "th", "thead", "tr", "u", "ul"]);
const HTMLISH = /<\/?[a-z][\s\S]*>/i;

/** Keep readable email markup and drop scripts, handlers, and unsafe URLs. */
export function sanitizeHtml(input: string): string {
  const stripped = input
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta|svg|math)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|form|link|meta|svg|math)\b[^>]*\/?\s*>/gi, "");
  return stripped.replace(/<\/?\s*([a-zA-Z0-9]+)([^>]*)>/g, (match, name: string, attrs: string) => {
    const tag = name.toLowerCase();
    if (!ALLOWED.has(tag)) return "";
    if (match.startsWith("</")) return `</${tag}>`;
    const safe = safeAttributes(tag, attrs);
    const empty = tag === "br" || tag === "hr";
    return `<${tag}${safe}${empty ? " /" : ""}>`;
  });
}

export function previewBlocks(value: unknown, prefix = ""): PreviewBlock[] {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    const label = prefix || "Details";
    if (HTMLISH.test(text)) {
      const html = sanitizeHtml(text);
      return html ? [{ label, html }] : [{ label, text: text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }];
    }
    return [{ label, text: text.slice(0, 4000) }];
  }
  if (typeof value === "number" || typeof value === "boolean") return [{ label: prefix || "Details", text: String(value) }];
  if (Array.isArray(value)) return value.flatMap((item, index) => previewBlocks(item, prefix || String(index + 1)));
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => previewBlocks(child, prefix ? `${prefix} · ${key}` : key));
  }
  return [];
}

function safeAttributes(tag: string, raw: string): string {
  const kept: string[] = [];
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let found: RegExpExecArray | null;
  while ((found = pattern.exec(raw))) {
    const name = found[1].toLowerCase();
    const value = found[3] ?? found[4] ?? found[5] ?? "";
    if (name.startsWith("on") || name === "style") continue;
    if ((name === "href" || name === "src") && /^(https?:|mailto:)/i.test(value.trim())) {
      kept.push(`${name}="${escapeAttr(value.trim())}"`);
    }
  }
  if (tag === "a") kept.push('rel="noopener noreferrer" target="_blank"');
  return kept.length ? ` ${kept.join(" ")}` : "";
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
