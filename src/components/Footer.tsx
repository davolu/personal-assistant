"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SITE } from "@/lib/site";

export default function Footer() {
  const pathname = usePathname();
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/create") || pathname.startsWith("/connect")) return null;
  return (
    <footer className="border-t border-line bg-panel">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xs">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-ink text-xs text-ground">⚡</span>
            <span className="font-bold tracking-tight">{SITE.name}</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted">{SITE.description}</p>
        </div>
        <div className="flex gap-16 text-sm">
          <div className="flex flex-col gap-2.5">
            <span className="font-mono text-xs uppercase tracking-widest text-muted">Product</span>
            <Link href="/agents" className="text-muted hover:text-ink">All 1,000+ templates</Link>
            <Link href="/pricing" className="text-muted hover:text-ink">Pricing</Link>
          </div>
          <div className="flex flex-col gap-2.5">
            <span className="font-mono text-xs uppercase tracking-widest text-muted">Built on</span>
            <span className="text-muted">Composio managed auth</span>
            <span className="text-muted">127 integrations</span>
          </div>
        </div>
      </div>
      <div className="border-t border-line py-5 text-center font-mono text-xs text-muted">
        © 2026 {SITE.name}. Savings figures are estimates at typical hourly rates.
      </div>
    </footer>
  );
}
