"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DesktopPanel } from "@/components/DesktopPanel";

const LINKS = [
  { href: "/agentic-chat", label: "Chat" },
  { href: "/schedule", label: "Schedule" },
  { href: "/apps", label: "Apps" },
  { href: "/approvals", label: "Approvals" },
  { href: "/settings", label: "Settings" },
  { href: "/dashboard", label: "Dashboard" },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const app = ["/agentic-chat", "/schedule", "/apps", "/approvals", "/settings", "/dashboard", "/connect"].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  if (!app) return null;
  return (
    <DesktopPanel
      storageKey="pa.panel.nav"
      label="navigation"
      edge="right"
      defaultWidth={224}
      minWidth={176}
      maxWidth={320}
      className="glass hidden min-h-0 shrink-0 overflow-y-auto border-r md:flex"
    >
      {({ collapsed, toggleButton }) => (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={`flex items-center ${collapsed ? "justify-center py-3" : "justify-between gap-1 px-2 pb-1 pt-3"}`}>
            {!collapsed && <p className="panel-label px-2">Assistant</p>}
            {toggleButton}
          </div>
          <nav aria-hidden={collapsed} inert={collapsed || undefined} className={collapsed ? "hidden" : "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 pb-3"}>
            {LINKS.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  tabIndex={collapsed ? -1 : undefined}
                  className={`min-h-11 rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${active ? "bg-ink text-ground shadow-sm" : "text-muted hover:bg-panel hover:text-ink"}`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </DesktopPanel>
  );
}
