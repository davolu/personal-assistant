"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/agentic-chat", label: "Chat", dot: "bg-blue" },
  { href: "/schedule", label: "Schedule", dot: "bg-yellow" },
  { href: "/apps", label: "Apps", dot: "bg-green" },
  { href: "/approvals", label: "Inbox", dot: "bg-coral" },
  { href: "/settings", label: "Settings", dot: "bg-ink" },
];

export default function MobileTabs() {
  const pathname = usePathname();
  return (
    <nav className="glass fixed inset-x-0 bottom-0 z-40 border-t md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="grid grid-cols-5">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link href={tab.href} className={`flex min-h-14 flex-col items-center justify-center gap-1 text-xs font-semibold ${active ? "text-ink" : "text-muted"}`}>
                <span className={`size-1.5 rounded-full ${active ? tab.dot : "bg-transparent"}`} aria-hidden="true" />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
