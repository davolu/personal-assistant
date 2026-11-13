"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { resetAnalytics } from "@/lib/analytics";
import { authClient, useSession } from "@/lib/auth-client";
import { SITE } from "@/lib/site";

const LINKS = [
  { href: "/agentic-chat", label: "Start chatting" },
  { href: "/apps", label: "Apps" },
  { href: "/pricing", label: "Pricing" },
];

export function SiteMenuLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { data: session } = useSession();
  const router = useRouter();
  return (
    <nav aria-label="Site" className="mt-2 border-t border-line px-2 pt-2">
      {LINKS.map((link) => (
        <Link key={link.href} href={link.href} onClick={onNavigate} className="press flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold active:bg-accent-soft">
          {link.label}
        </Link>
      ))}
      <Link href={session ? "/dashboard" : "/signin"} onClick={onNavigate} className="press flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold active:bg-accent-soft">
        {session ? "Dashboard" : "Sign in"}
      </Link>
      {session && (
        <button
          type="button"
          className="press flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-semibold active:bg-accent-soft"
          onClick={() => {
            onNavigate?.();
            void authClient.signOut().then((result) => {
              if (!result?.error) resetAnalytics();
              router.push("/");
              router.refresh();
            });
          }}
        >
          Sign out
        </button>
      )}
      <p className="px-3 pb-1 pt-3 text-xs text-muted">© 2026 {SITE.name}</p>
    </nav>
  );
}
