"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { relativeCallbackPath } from "@/lib/auth-base-url";
import { explainAuthError } from "@/lib/auth-error";
import { authClient } from "@/lib/auth-client";
import { runMutation } from "@/lib/mutate";
import { PASSWORD_RESET_SENT } from "@/lib/password-reset";

const fieldClass =
  "min-h-12 w-full rounded-full border border-line bg-ground px-4 text-[15px] outline-none placeholder:text-muted/70 focus:border-ink focus:ring-2 focus:ring-ink/10";

export default function ForgotPasswordForm({ enabled }: { enabled: boolean }) {
  const next = relativeCallbackPath(useSearchParams().get("next"));
  const signInHref = `/signin?next=${encodeURIComponent(next)}`;
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const failure = "Couldn't reach the server — check your connection and try again.";
    const redirectTo = `/reset-password?next=${encodeURIComponent(next)}`;
    const outcome = await runMutation(
      () => authClient.requestPasswordReset({ email, redirectTo }),
      {
        failure,
        result: (res) => {
          if (res.error) {
            const disabled = (res.error.code ?? "").toUpperCase() === "RESET_PASSWORD_DISABLED";
            return {
              tone: "error",
              message: disabled ? "Password reset isn't available right now." : explainAuthError(res.error.message, res.error.code),
            };
          }
          return { tone: "success", message: PASSWORD_RESET_SENT };
        },
      },
    );
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error || failure);
      return;
    }
    setSent(true);
  }

  return (
    <div className="surface mx-auto w-full max-w-sm overflow-hidden">
      <div className="h-2 bg-blue" />
      <div className="p-6 sm:p-8">
        <p className="kicker text-center">Account</p>
        <h1 className="mt-2 text-balance text-center text-3xl font-bold">Forgot your password?</h1>
        <p className="mt-2 text-center text-sm text-muted">
          Enter the email on your account. If it matches, we'll send a link that expires in one hour.
        </p>

        {!enabled ? (
          <p className="mt-8 rounded-2xl bg-gold-soft px-4 py-3 text-sm text-gold">
            Password reset isn't available right now. Sign in with your password, or create an account.
          </p>
        ) : sent ? (
          <p className="mt-8 rounded-2xl bg-mint-soft px-4 py-3 text-sm text-mint" role="status">
            {PASSWORD_RESET_SENT}
          </p>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-3">
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              autoComplete="email"
              className={fieldClass}
            />
            {error && <p className="text-sm text-accent-dark">{error}</p>}
            <button disabled={busy} className="btn-ink w-full disabled:opacity-60">
              {busy ? "One moment…" : "Send reset link"}
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-sm text-muted">
          <Link href={signInHref} className="font-semibold text-accent-dark hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
