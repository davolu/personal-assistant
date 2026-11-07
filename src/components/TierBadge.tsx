import { TIERS, type TierKey } from "@/lib/site";

const styles: Record<TierKey, string> = {
  lite: "bg-mint-soft text-mint",
  standard: "bg-gold-soft text-gold",
  pro: "bg-accent-soft text-accent-dark",
};

export default function TierBadge({ tier }: { tier: TierKey }) {
  const t = TIERS[tier];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide ${styles[tier]}`}
    >
      {t.emoji} {t.label}
    </span>
  );
}
