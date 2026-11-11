"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient, useSession } from "@/lib/auth-client";
import { SHOW_LEGACY_CREATE_AGENT } from "@/lib/features";

export default function NavSession() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  if (isPending) {
    return <span className="ml-2 h-9 w-24 animate-pulse rounded-lg bg-line" />;
  }

  if (!session) {
    return (
      <>
        <Link href="/signin" className="rounded-lg px-3 py-2 text-muted hover:bg-accent-soft hover:text-ink">
          Sign in
        </Link>
        <Link
          href={SHOW_LEGACY_CREATE_AGENT ? "/create" : "/chat"}
          className="ml-2 rounded-lg bg-accent px-4 py-2 font-semibold text-white shadow-sm transition hover:bg-accent-dark"
        >
          {SHOW_LEGACY_CREATE_AGENT ? "Build an agent" : "Open chat"}
        </Link>
      </>
    );
  }

  return (
    <>
      <Link href="/dashboard" className="ml-2 rounded-lg bg-ink px-4 py-2 font-semibold text-ground transition hover:bg-ink/85">
        Dashboard
      </Link>
      <button
        onClick={async () => {
          await authClient.signOut();
          router.push("/");
          router.refresh();
        }}
        className="rounded-lg px-3 py-2 text-muted hover:bg-accent-soft hover:text-ink"
      >
        Sign out
      </button>
    </>
  );
}
