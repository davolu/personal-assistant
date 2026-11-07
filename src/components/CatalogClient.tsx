"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import catalog from "@/data/catalog.json";
import BotCard, { type BotCardData } from "@/components/BotCard";
import { TIERS, type TierKey } from "@/lib/site";
import { toolkitLogo } from "@/lib/toolkits";

type CatalogBot = BotCardData & { group: string };
const all = catalog as CatalogBot[];
const groups = [...new Set(all.map((b) => b.group))];
const appCounts = (() => {
  const m = new Map<string, number>();
  for (const b of all) for (const t of b.toolkits) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
})();
const TOP_APPS = 10;
const PAGE = 48;

export default function CatalogClient() {
  const sp = useSearchParams();
  const initialGroup = sp.get("group") ?? "";
  const initialApp = sp.get("app") ?? "";
  const [q, setQ] = useState("");
  const [group, setGroup] = useState(groups.includes(initialGroup) ? initialGroup : "");
  const [app, setApp] = useState(initialApp);
  const [tier, setTier] = useState<TierKey | "">("");
  const [limit, setLimit] = useState(PAGE);
  const [showAllApps, setShowAllApps] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (b) =>
        (!group || b.group === group) &&
        (!tier || b.tier === tier) &&
        (!app || b.toolkits.includes(app)) &&
        (!needle ||
          b.name.toLowerCase().includes(needle) ||
          b.desc.toLowerCase().includes(needle) ||
          b.category.toLowerCase().includes(needle) ||
          b.toolkits.some((t) => t.toLowerCase().includes(needle)))
    );
  }, [q, group, tier, app]);

  const shown = filtered.slice(0, limit);
  const appLogo = app ? toolkitLogo(app, 32) : null;

  return (
    <div>
      <div className="flex flex-col gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setLimit(PAGE);
          }}
          placeholder="Search over 1,000 templates — by name, job, or app: “invoice”, “Notion”, “WhatsApp”…"
          className="w-full rounded-xl border border-line bg-panel px-4 py-3 text-[15px] shadow-sm outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill active={group === ""} onClick={() => { setGroup(""); setLimit(PAGE); }}>
            All
          </FilterPill>
          {groups.map((g) => (
            <FilterPill key={g} active={group === g} onClick={() => { setGroup(g); setLimit(PAGE); }}>
              {g}
            </FilterPill>
          ))}
          <span className="mx-1 h-5 w-px bg-line" />
          {(Object.keys(TIERS) as TierKey[]).map((t) => (
            <FilterPill
              key={t}
              active={tier === t}
              onClick={() => { setTier(tier === t ? "" : t); setLimit(PAGE); }}
            >
              {TIERS[t].emoji} {TIERS[t].label}
            </FilterPill>
          ))}
        </div>
        {/* App filter row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-widest text-muted">Apps:</span>
          {(showAllApps ? appCounts : appCounts.slice(0, TOP_APPS)).map(([name, count]) => {
            const logo = toolkitLogo(name, 32);
            const active = app === name;
            return (
              <button
                key={name}
                onClick={() => {
                  setApp(active ? "" : name);
                  setLimit(PAGE);
                }}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "border-ink bg-ink text-ground"
                    : "border-line bg-panel text-muted hover:border-ink/30 hover:text-ink"
                }`}
              >
                {logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} alt="" className="size-3.5 rounded-[2px]" loading="lazy" />
                )}
                {name}
                <span className={`font-mono text-[10px] ${active ? "text-ground/60" : "text-muted/70"}`}>{count}</span>
              </button>
            );
          })}
          <button
            onClick={() => setShowAllApps((v) => !v)}
            className="rounded-full border border-dashed border-line bg-panel px-3 py-1.5 text-xs font-semibold text-accent-dark transition hover:border-accent/40"
          >
            {showAllApps ? "Show fewer apps ↑" : `+ ${appCounts.length - TOP_APPS} more apps`}
          </button>
        </div>
        <div className="flex items-center gap-3">
          {app && (
            <button
              onClick={() => { setApp(""); setLimit(PAGE); }}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-ground"
            >
              {appLogo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={appLogo} alt="" className="size-3.5 rounded-[2px]" />
              )}
              {app} ✕
            </button>
          )}
          <p className="font-mono text-xs text-muted">
            {filtered.length.toLocaleString()} template{filtered.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((b) => (
          <BotCard key={b.slug} bot={b} />
        ))}
      </div>

      {filtered.length > limit && (
        <div className="mt-8 text-center">
          <button
            onClick={() => setLimit((l) => l + PAGE)}
            className="rounded-lg border border-line bg-panel px-6 py-3 text-sm font-semibold shadow-sm transition hover:border-accent/40 hover:text-accent-dark"
          >
            Show more ({(filtered.length - limit).toLocaleString()} remaining)
          </button>
        </div>
      )}
      {filtered.length === 0 && (
        <div className="mt-16 text-center">
          <p className="text-muted">No templates match — but you can build exactly this.</p>
          <Link href="/create" className="mt-3 inline-block font-semibold text-accent-dark hover:underline">
            ✨ Create your own agent →
          </Link>
        </div>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-ink bg-ink text-ground"
          : "border-line bg-panel text-muted hover:border-ink/30 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
