"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { resetAnalytics } from "@/lib/analytics";
import { authClient, useSession } from "@/lib/auth-client";
import { runMutation } from "@/lib/mutate";

type Credits = {
  plan: string;
  remaining: number;
  allowance: number;
  topup: number;
  low: boolean;
  usage: { id: string; type: string; credits: number; at: string }[];
};

export default function SettingsPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [credits, setCredits] = useState<Credits | null>(null);
  useEffect(() => {
    if (!session) return;
    void fetch("/api/credits")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setCredits(json as Credits | null))
      .catch(() => setCredits(null));
  }, [session]);
  return (
    <div className="mx-auto max-w-lg px-4 py-4 md:py-6">
      <p className="kicker max-md:hidden">Account</p>
      <h1 className="mt-2 text-3xl font-bold max-md:hidden">Settings</h1>
      <div className="mt-4 space-y-3">
        <div className="surface p-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted">Account</p>
          {isPending ? (
            <p className="skeleton mt-3 h-4 w-40 rounded-full" />
          ) : session ? (
            <p className="mt-2 break-all text-sm font-medium">{session.user.email}</p>
          ) : (
            <Link href="/signin" className="btn-ink mt-3 text-sm">
              Sign in
            </Link>
          )}
        </div>
        {session && (
          <div className="surface p-4">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted">Credits</p>
            {credits ? (
              <>
                <p className="mt-2 text-2xl font-bold tracking-tight">{credits.remaining.toLocaleString()} left</p>
                <p className="mt-1 text-sm text-muted">
                  {credits.plan} plan · {credits.allowance.toLocaleString()} monthly
                  {credits.topup > 0 ? ` · ${credits.topup.toLocaleString()} top-up credits do not expire` : ""}
                </p>
                {credits.low && <p className="mt-2 text-sm font-medium">Credits are running low.</p>}
                {credits.remaining <= 0 && <p className="mt-2 text-sm font-medium">You are out of credits.</p>}
                <ul className="mt-3 space-y-1 text-sm text-muted">
                  {credits.usage.slice(0, 5).map((item) => (
                    <li key={item.id} className="flex justify-between gap-3">
                      <span>{item.type === "web_search" ? "Web search" : item.type === "desktop" ? "Cloud desktop" : "Model"}</span>
                      <span className="font-mono text-xs">{item.credits} credits</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="skeleton mt-3 h-4 w-32 rounded-full" />
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/pricing" className="btn-ink text-sm">Top up or upgrade</Link>
            </div>
          </div>
        )}
        <Link href="/dashboard" className="surface flex min-h-12 items-center px-4 text-sm font-semibold">
          Agent dashboard
        </Link>
        <Link href="/apps" className="surface flex min-h-12 items-center px-4 text-sm font-semibold">
          Connected apps
        </Link>
        {session && (
          <button
            className="btn-ghost w-full justify-start px-4 text-sm"
            onClick={async () => {
              const outcome = await runMutation(() => authClient.signOut(), {
                success: "Signed out",
                failure: "Couldn't sign out — try again.",
              });
              if (!outcome.ok) return;
              resetAnalytics();
              router.push("/");
              router.refresh();
            }}
          >
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
