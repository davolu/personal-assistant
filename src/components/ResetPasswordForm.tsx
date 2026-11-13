"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { relativeCallbackPath } from "@/lib/auth-base-url";
import { explainAuthError } from "@/lib/auth-error";
import { authClient } from "@/lib/auth-client";
import { runMutation } from "@/lib/mutate";
import {
  PASSWORD_RESET_INVALID,
  PASSWORD_RESET_UPDATED,
  isInvalidResetToken,
  passwordIssue,
} from "@/lib/password-reset";
import { REPLAY_MASK_CLASS } from "@/lib/posthog";
import { notify } from "@/lib/toast";

const fieldClass =
  "min-h-12 w-full rounded-full border border-line bg-ground px-4 text-[15px] outline-none placeholder:text-muted/70 focus:border-ink focus:ring-2 focus:ring-ink/10";

export default function ResetPasswordForm({ passwordResetEnabled }: { passwordResetEnabled: boolean }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = relativeCallbackPath(search.get("next"));
  const token = (search.get("token") ?? "").trim();
  const linkError = (search.get("error") ?? "").trim();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(!token || isInvalidResetToken(linkError, linkError));
  const [busy, setBusy] = useState(false);
  const signInHref = `/signin?next=${encodeURIComponent(next)}`;
  const forgotHref = `/forgot-password?next=${encodeURIComponent(next)}`;

  useEffect(() => {
    if (!token || isInvalidResetToken(linkError, linkError)) notify(PASSWORD_RESET_INVALID, "error");
  }, [token, linkError]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const issue = passwordIssue(password, confirm);
    if (issue) {
      setError(issue);
      notify(issue, "error");
      return;
    }
    setError("");
    setBusy(true);
    const failure = "Couldn't reach the server — check your connection and try again.";
    const outcome = await runMutation(
      () => authClient.resetPassword({ newPassword: password, token }),
      {
        failure,
        result: (res) => {
          if (res.error) {
            if (isInvalidResetToken(res.error.message, res.error.code)) {
              return { tone: "error", message: PASSWORD_RESET_INVALID };
            }
            return { tone: "error", message: explainAuthError(res.error.message, res.error.code) };
          }
          return null;
        },
      },
    );
    if (!outcome.ok) {
      setBusy(false);
      const message = outcome.error || failure;
      setError(message);
      if (message === PASSWORD_RESET_INVALID) setExpired(true);
      return;
    }

    const session = await authClient.getSession().catch(() => null);
    if (session?.data?.session) {
      notify(PASSWORD_RESET_UPDATED, "success");
      router.push(next);
      router.refresh();
      return;
    }
    router.push(`${signInHref}&reset=done`);
    router.refresh();
  }

  return (
    <div className="surface mx-auto w-full max-w-sm overflow-hidden">
      <div className="h-2 bg-coral" />
      <div className="p-6 sm:p-8">
        <p className="kicker text-center">Account</p>
        <h1 className="mt-2 text-balance text-center text-3xl font-bold">Choose a new password</h1>
        <p className="mt-2 text-center text-sm text-muted">Use at least 8 characters. This replaces the password on your account.</p>

        {expired ? (
          <div className="mt-8 space-y-4">
            <p className="rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
              {PASSWORD_RESET_INVALID}
            </p>
            {passwordResetEnabled ? (
              <Link href={forgotHref} className="btn-ink w-full">
                Request a new link
              </Link>
            ) : null}
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-3">
            <input
              required
              type="password"
              name="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (8+ characters)"
              autoComplete="new-password"
              className={`${REPLAY_MASK_CLASS} ${fieldClass}`}
            />
            <input
              required
              type="password"
              name="confirm-password"
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              className={`${REPLAY_MASK_CLASS} ${fieldClass}`}
            />
            {error && <p className="text-sm text-accent-dark">{error}</p>}
            <button disabled={busy} className="btn-ink w-full disabled:opacity-60">
              {busy ? "One moment…" : "Update password"}
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
