import Link from "next/link";
import { SITE } from "@/lib/site";
import NavSession from "@/components/NavSession";

export default function Nav() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ground/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center rounded-lg bg-ink text-sm font-bold text-ground">
            ⚡
          </span>
          <span className="text-[17px] font-bold tracking-tight">{SITE.name}</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm font-medium">
          <Link href="/chat" className="rounded-lg px-3 py-2 text-muted hover:bg-accent-soft hover:text-ink">
            Chat
          </Link>
          <Link href="/agents" className="rounded-lg px-3 py-2 text-muted hover:bg-accent-soft hover:text-ink">
            Templates
          </Link>
          <Link href="/apps" className="rounded-lg px-3 py-2 text-muted hover:bg-accent-soft hover:text-ink">
            Apps
          </Link>
          <Link href="/create" className="rounded-lg px-3 py-2 text-muted hover:bg-accent-soft hover:text-ink">
            Create
          </Link>
          <Link href="/pricing" className="rounded-lg px-3 py-2 text-muted hover:bg-accent-soft hover:text-ink">
            Pricing
          </Link>
          <NavSession />
        </nav>
      </div>
    </header>
  );
}
