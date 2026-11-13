"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { SITE } from "@/lib/site";

const HIDDEN = ["/dashboard", "/connect", "/approvals", "/settings", "/apps", "/agentic-chat", "/signin", "/signup", "/pricing"];

export default function Footer() {
  const pathname = usePathname() ?? "";
  const { data: session } = useSession();
  if (HIDDEN.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;

  return (
    <footer className="bg-ink text-ground">
      <div className="mx-auto max-w-6xl px-5 pb-8 pt-16 sm:pt-20">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <Link href="/" className="inline-flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-lg bg-ground text-sm font-bold text-ink">⚡</span>
              <span className="text-lg font-bold tracking-tight">{SITE.name}</span>
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-ground/70">{SITE.tagline}</p>
          </div>
          <nav className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm sm:grid-cols-2" aria-label="Footer">
            <Link href="/agentic-chat" className="font-medium text-ground/80 transition hover:text-ground">
              Start chatting
            </Link>
            <Link href="/apps" className="font-medium text-ground/80 transition hover:text-ground">
              Apps
            </Link>
            <Link href="/pricing" className="font-medium text-ground/80 transition hover:text-ground">
              Pricing
            </Link>
            <Link href={session ? "/dashboard" : "/signin"} className="font-medium text-ground/80 transition hover:text-ground">
              {session ? "Dashboard" : "Sign in"}
            </Link>
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-ground/15 pt-6 text-xs text-ground/55 sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 {SITE.name}</p>
          <p>Built on Composio</p>
        </div>
      </div>
    </footer>
  );
}
