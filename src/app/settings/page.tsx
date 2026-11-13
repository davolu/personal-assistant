"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth-client";
import { runMutation } from "@/lib/mutate";

export default function SettingsPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  return (
    <div className="mx-auto max-w-lg px-4 py-6">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
      <div className="mt-4 space-y-3">
        <div className="rounded-2xl border border-line bg-panel p-4">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted">Account</p>
          {isPending ? (
            <p className="mt-2 text-sm text-muted">Checking session…</p>
          ) : session ? (
            <p className="mt-2 break-all text-sm font-medium">{session.user.email}</p>
          ) : (
            <Link href="/signin" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-white">
              Sign in
            </Link>
          )}
        </div>
        <Link href="/dashboard" className="flex min-h-12 items-center rounded-2xl border border-line bg-panel px-4 text-sm font-semibold">
          Agent dashboard
        </Link>
        <Link href="/apps" className="flex min-h-12 items-center rounded-2xl border border-line bg-panel px-4 text-sm font-semibold">
          Connected apps
        </Link>
        {session && (
          <button
            className="flex min-h-12 w-full items-center rounded-2xl border border-line px-4 text-left text-sm font-semibold"
            onClick={async () => {
              const outcome = await runMutation(() => authClient.signOut(), {
                success: "Signed out",
                failure: "Couldn't sign out — try again.",
              });
              if (!outcome.ok) return;
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
