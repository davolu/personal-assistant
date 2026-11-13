"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DesktopPanel } from "@/components/DesktopPanel";

const LINKS = [
  { href: "/agentic-chat", label: "Agent" },
  { href: "/apps", label: "Apps" },
  { href: "/approvals", label: "Approvals" },
  { href: "/settings", label: "Settings" },
  { href: "/dashboard", label: "Dashboard" },
];

export default function AppSidebar() {
  const pathname = usePathname();
  const app = ["/agentic-chat", "/apps", "/approvals", "/settings", "/dashboard", "/connect"].some(
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
      className="hidden min-h-0 shrink-0 overflow-y-auto border-r border-line bg-panel md:flex"
    >
      {({ collapsed, toggleButton }) => (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={`flex items-center ${collapsed ? "justify-center py-3" : "justify-between gap-1 px-2 pb-1 pt-3"}`}>
            {!collapsed && <p className="px-2 font-mono text-[10px] uppercase tracking-widest text-muted">Assistant</p>}
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
                  className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${active ? "bg-accent-soft text-accent-dark" : "text-muted hover:bg-ground hover:text-ink"}`}
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
