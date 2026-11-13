"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { resetAnalytics } from "@/lib/analytics";
import { authClient, useSession } from "@/lib/auth-client";
import { runMutation } from "@/lib/mutate";

export default function NavSession() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  if (isPending) {
    return <span className="skeleton ml-2 h-9 w-24 rounded-full" />;
  }

  if (!session) {
    return (
      <>
        <Link href="/signin" className="btn-ink ml-1 px-4">
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <button
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
        className="min-h-11 rounded-full px-3 py-2 text-muted hover:bg-panel hover:text-ink"
      >
        Sign out
      </button>
    </>
  );
}
