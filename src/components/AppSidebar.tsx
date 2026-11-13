"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel md:flex">
      <p className="px-4 pb-2 pt-5 font-mono text-[10px] uppercase tracking-widest text-muted">Assistant</p>
      <nav className="flex flex-col gap-1 px-2">
        {LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${active ? "bg-accent-soft text-accent-dark" : "text-muted hover:bg-ground hover:text-ink"}`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
