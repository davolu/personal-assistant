import Link from "next/link";
import TierBadge from "@/components/TierBadge";
import ToolkitChip from "@/components/ToolkitChip";
import type { TierKey } from "@/lib/site";

export type BotCardData = {
  slug: string;
  name: string;
  desc: string;
  toolkits: string[];
  category: string;
  tier: TierKey;
  price: number;
};

export default function BotCard({ bot }: { bot: BotCardData }) {
  return (
    <Link
      href={`/agents/${bot.slug}`}
      className="group flex flex-col rounded-xl border border-line bg-panel p-5 transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold leading-snug tracking-tight group-hover:text-accent-dark">
          {bot.name}
        </h3>
        <TierBadge tier={bot.tier} />
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted">{bot.desc}.</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {bot.toolkits.slice(0, 3).map((t) => (
          <ToolkitChip key={t} name={t} />
        ))}
        {bot.toolkits.length > 3 && (
          <span className="px-1 font-mono text-[11px] text-muted">+{bot.toolkits.length - 3}</span>
        )}
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-sm">
        <span className="font-mono text-xs text-muted">{bot.category}</span>
        <span className="font-mono text-xs font-semibold text-mint">✓ Included</span>
      </div>
    </Link>
  );
}
