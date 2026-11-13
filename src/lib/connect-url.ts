/** Same app across display names and slugs, without a fixed app list. */
export function sameApp(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const squash = (value: string) => value.replace(/[^a-z0-9]/g, "");
  return squash(a) === squash(b);
}

/** Composio's own auth hosts. App names are not listed here. */
export function isComposioConnectUrl(href: string): boolean {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return host === "composio.dev" || host.endsWith(".composio.dev") || host === "composio.io" || host.endsWith(".composio.io");
  } catch {
    return false;
  }
}
