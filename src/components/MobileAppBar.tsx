"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { appBarTitle } from "@/components/app-routes";
import { MobileLayer } from "@/components/mobile-overlay";
import { SiteMenuLinks } from "@/components/SiteMenu";

export default function MobileAppBar() {
  const pathname = usePathname() ?? "";
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const title = appBarTitle(pathname);
  const initial = (session?.user?.name || session?.user?.email || "").trim().charAt(0).toUpperCase();
  return (
    <>
      <header data-mobile-appbar className="glass z-30 shrink-0 border-b md:hidden" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="grid h-14 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center px-1">
          <button type="button" data-menu-button className="press grid size-11 place-items-center rounded-full" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(true)}>
            {initial ? <span className="grid size-8 place-items-center rounded-full bg-ink text-sm font-bold text-ground">{initial}</span> : <MenuIcon />}
          </button>
          <h1 className="truncate px-2 text-center text-[15px] font-semibold">{title}</h1>
          <span aria-hidden="true" />
        </div>
      </header>
      {open && (
        <MobileLayer kind="sheet" label="Menu" onClose={() => setOpen(false)}>
          <p className="px-4 text-sm font-semibold">{title}</p>
          <SiteMenuLinks onNavigate={() => setOpen(false)} />
        </MobileLayer>
      )}
    </>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none">
      <path d="M4 6h12M4 10h12M4 14h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
