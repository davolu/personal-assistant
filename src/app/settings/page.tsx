"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth-client";

export default function SettingsPage() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
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
              await authClient.signOut();
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
