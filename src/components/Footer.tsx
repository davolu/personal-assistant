"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mark } from "@/components/illustrations";
import { useSession } from "@/lib/auth-client";
import { SITE } from "@/lib/site";

const HIDDEN = ["/dashboard", "/connect", "/approvals", "/settings", "/apps", "/agentic-chat", "/signin", "/signup", "/pricing", "/schedule"];

export default function Footer() {
  const pathname = usePathname() ?? "";
  const { data: session } = useSession();
  if (HIDDEN.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null;

  return (
    <footer className="border-t border-line">
      <div className="mx-auto max-w-6xl px-5 pb-8 pt-14 sm:pt-16">
        <div className="flex flex-col gap-10 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-sm">
            <Link href="/" className="inline-flex items-center gap-2">
              <Mark />
              <span className="text-lg font-bold tracking-tight">{SITE.name}</span>
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-muted">{SITE.tagline}</p>
          </div>
          <nav className="grid grid-cols-2 gap-x-10 gap-y-3 text-sm" aria-label="Footer">
            <Link href="/agentic-chat" className="min-h-11 font-medium text-ink/80 transition hover:text-ink">
              Start chatting
            </Link>
            <Link href="/apps" className="min-h-11 font-medium text-ink/80 transition hover:text-ink">
              Apps
            </Link>
            <Link href="/pricing" className="min-h-11 font-medium text-ink/80 transition hover:text-ink">
              Pricing
            </Link>
            <Link href={session ? "/dashboard" : "/signin"} className="min-h-11 font-medium text-ink/80 transition hover:text-ink">
              {session ? "Dashboard" : "Sign in"}
            </Link>
          </nav>
        </div>
        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 {SITE.name}</p>
          <p className="flex items-center gap-2" aria-hidden="true">
            <span className="size-2 rounded-full bg-blue" />
            <span className="size-2 rounded-full bg-green" />
            <span className="size-2 rounded-full bg-coral" />
            <span className="size-2 rounded-full bg-yellow" />
          </p>
        </div>
      </div>
    </footer>
  );
}
