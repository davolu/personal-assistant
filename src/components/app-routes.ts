export const APP_PREFIXES = ["/agentic-chat", "/schedule", "/apps", "/approvals", "/settings", "/dashboard", "/connect"] as const;

export function isAppPath(pathname: string): boolean {
  return APP_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function appBarTitle(pathname: string): string {
  if (pathname.startsWith("/schedule")) return "Schedule";
  if (pathname.startsWith("/apps")) return "Apps";
  if (pathname.startsWith("/approvals")) return "Inbox";
  if (pathname.startsWith("/settings")) return "Settings";
  if (pathname.startsWith("/dashboard")) return "Dashboard";
  if (pathname.startsWith("/connect")) return "Connect";
  if (pathname.startsWith("/agentic-chat")) return "Chat";
  return "AgentDock";
}
