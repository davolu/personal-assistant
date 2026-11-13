import Link from "next/link";
import { SITE } from "@/lib/site";
import NavSession from "@/components/NavSession";

export default function Nav() {
  return (
    <header className="sticky top-0 z-40 shrink-0 border-b border-line bg-ground/95 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-2 px-3 md:h-16 md:px-5">
        <Link href="/" className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-ink text-sm font-bold text-ground">
            ⚡
          </span>
          <span className="truncate text-[15px] font-bold tracking-tight md:text-[17px]">{SITE.name}</span>
        </Link>
        <nav className="hidden items-center gap-1 text-sm font-medium lg:flex">
          <Link href="/agentic-chat" className="rounded-lg px-3 py-2 text-muted hover:bg-accent-soft hover:text-ink">
            Agent
          </Link>
          <Link href="/apps" className="rounded-lg px-3 py-2 text-muted hover:bg-accent-soft hover:text-ink">
            Apps
          </Link>
          <Link href="/pricing" className="rounded-lg px-3 py-2 text-muted hover:bg-accent-soft hover:text-ink">
            Pricing
          </Link>
          <Link href="/dashboard" className="rounded-lg px-3 py-2 text-muted hover:bg-accent-soft hover:text-ink">
            Dashboard
          </Link>
          <NavSession />
        </nav>
      </div>
    </header>
  );
}
