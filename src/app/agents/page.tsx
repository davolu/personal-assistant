import type { Metadata } from "next";
import { Suspense } from "react";
import CatalogClient from "@/components/CatalogClient";

export const metadata: Metadata = {
  title: "Over 1,000 templates",
  description: "Search and filter 1,000 ready-made AI agents by niche, tier, and the tools they use.",
};

export default function BotsPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12">
      <p className="font-mono text-xs uppercase tracking-widest text-accent-dark">The catalog</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight">Over 1,000 ready templates</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Every agent connects to your real accounts with one-click auth, runs on your schedule, and
        comes with a monthly run allowance. Click any agent for the full breakdown.
      </p>
      <div className="mt-8">
        <Suspense>
          <CatalogClient />
        </Suspense>
      </div>
    </div>
  );
}
