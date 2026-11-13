import Link from "next/link";
import { LOGO_WORDMARK, Mark } from "@/components/illustrations";
import NavSession from "@/components/NavSession";

const links = [
  { href: "/agentic-chat", label: "Chat" },
  { href: "/schedule", label: "Schedule" },
  { href: "/apps", label: "Apps" },
  { href: "/pricing", label: "Pricing" },
  { href: "/dashboard", label: "Dashboard" },
];

export default function Nav() {
  return (
    <header className="glass sticky top-0 z-40 shrink-0 border-b">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 md:h-16 md:px-5">
        <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2">
          <Mark className="size-8 shrink-0" />
          <span className="whitespace-nowrap text-[15px] font-bold tracking-tight md:text-[17px]">{LOGO_WORDMARK}</span>
        </Link>
        <nav className="hidden items-center gap-1 text-sm font-medium lg:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="min-h-11 rounded-full px-3 py-2 text-muted hover:bg-panel hover:text-ink">
              {link.label}
            </Link>
          ))}
          <NavSession />
        </nav>
      </div>
    </header>
  );
}
