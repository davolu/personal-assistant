"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { capture } from "@/lib/analytics";

export function UpgradeLink({
  href,
  className,
  children,
  plan,
  source,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  plan: string;
  source: string;
}) {
  return (
    <Link href={href} className={className} onClick={() => capture("plan_upgrade_clicked", { plan, source })}>
      {children}
    </Link>
  );
}

export function PlanCheckoutButton({ plan, className, children }: { plan: string; className?: string; children: ReactNode }) {
  return (
    <button className={className} onClick={() => capture("plan_upgrade_clicked", { plan, source: "pricing" })}>
      {children}
    </button>
  );
}
