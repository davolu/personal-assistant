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
  const pathname = usePathname() ?? "";
  return (
    <nav data-mobile-tabs className="glass fixed inset-x-0 bottom-0 z-40 border-t md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="grid grid-cols-5">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`press flex min-h-11 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-semibold ${active ? "text-ink" : "text-muted"}`}
              >
                <span className={`relative grid size-7 place-items-center rounded-full ${active ? "bg-panel" : ""}`}>
                  <TabIcon name={tab.label} />
                  <span className={`absolute bottom-0 size-1.5 rounded-full ${active ? tab.dot : "bg-transparent"}`} aria-hidden="true" />
                </span>
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function TabIcon({ name }: { name: string }) {
  const common = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", "aria-hidden": true as const };
  if (name === "Chat") {
    return (
      <svg {...common}>
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v6A1.5 1.5 0 0 1 14.5 13H9l-3 2.2V13H5.5A1.5 1.5 0 0 1 4 11.5v-6Z" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  if (name === "Schedule") {
    return (
      <svg {...common}>
        <rect x="3.5" y="4.5" width="13" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3.5 8h13M7 3.5v2.5M13 3.5v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (name === "Apps") {
    return (
      <svg {...common}>
        <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
        <rect x="11" y="3.5" width="5.5" height="5.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
        <rect x="3.5" y="11" width="5.5" height="5.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
        <rect x="11" y="11" width="5.5" height="5.5" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  if (name === "Inbox") {
    return (
      <svg {...common}>
        <path d="M3.5 11.5 6 5.5h8l2.5 6v3.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-3.5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M3.5 11.5h3.2a1.6 1.6 0 0 0 1.5 1h3.6a1.6 1.6 0 0 0 1.5-1h3.2" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="10" cy="10" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 3.6v1.4M10 15v1.4M3.6 10h1.4M15 10h1.4M5.4 5.4l1 1M13.6 13.6l1 1M14.6 5.4l-1 1M6.4 13.6l-1 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
