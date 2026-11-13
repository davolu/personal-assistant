"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { capture, identifyUser, rememberAuthIntent, takeAuthIntent } from "@/lib/analytics";
import { relativeCallbackPath } from "@/lib/auth-base-url";
import { explainAuthError } from "@/lib/auth-error";
import { authClient } from "@/lib/auth-client";
import { runMutation } from "@/lib/mutate";
import { PASSWORD_RESET_UPDATED } from "@/lib/password-reset";
import { REPLAY_MASK_CLASS } from "@/lib/posthog";
import { SITE } from "@/lib/site";
import { notify } from "@/lib/toast";
import { socialSignInMessage, type EnabledSocialProvider } from "@/lib/social-providers";

const fieldClass =
  "min-h-12 w-full rounded-full border border-line bg-ground px-4 text-[15px] outline-none placeholder:text-muted/70 focus:border-ink focus:ring-2 focus:ring-ink/10";

export default function AuthForm({
  mode,
  providers,
  passwordResetEnabled,
}: {
  mode: "signin" | "signup";
  providers: EnabledSocialProvider[];
  passwordResetEnabled: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const next = relativeCallbackPath(search.get("next"));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const reset = search.get("reset");
    const oauthError = search.get("error");
    const notice = reset === "done" ? PASSWORD_RESET_UPDATED : socialSignInMessage(oauthError);
    if (!notice) return;
    notify(notice, reset === "done" ? "success" : "error");
    const url = new URL(window.location.href);
    url.searchParams.delete("reset");
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    const query = url.searchParams.toString();
    window.history.replaceState(null, "", query ? `${url.pathname}?${query}` : url.pathname);
  }, [search]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const failure = "Couldn't reach the server — check your connection and try again.";
    const outcome = await runMutation(
      () => (mode === "signup" ? authClient.signUp.email({ name, email, password }) : authClient.signIn.email({ email, password })),
      {
        failure,
        result: (res) => {
          if (res.error) return { tone: "error", message: explainAuthError(res.error.message, res.error.code) };
          return { tone: "success", message: mode === "signup" ? "Account created" : "Signed in" };
        },
      },
    );
    setBusy(false);
    if (!outcome.ok) {
      setError(outcome.error || failure);
      return;
    }
    takeAuthIntent();
    const user = authUser(outcome.value);
    await identifyUser(user?.id ?? "", {
      email: user?.email ?? email,
      name: user?.name ?? (mode === "signup" ? name : undefined),
    });
    capture(mode === "signup" ? "signed_up" : "signed_in", { method: "email" });
    router.push(next);
    router.refresh();
  }

  async function continueWith(provider: EnabledSocialProvider) {
    setBusy(true);
    rememberAuthIntent(mode === "signup" ? "signed_up" : "signed_in", provider.id);
    await runMutation(() => authClient.signIn.social({ provider: provider.id, callbackURL: next }), {
      failure: `Couldn't reach ${provider.label} sign-in — try again.`,
      result: (res) => {
        if (res.error) return { tone: "error", message: explainAuthError(res.error.message, res.error.code) };
        return null;
      },
    });
    setBusy(false);
  }

  return (
    <div className="surface mx-auto w-full max-w-sm p-6 sm:p-8">
      <h1 className="text-balance text-center text-3xl font-bold">
        {mode === "signup" ? "Create your account" : SITE.signInTitle}
      </h1>
      <p className="mt-2 text-center text-sm text-muted">
        {mode === "signup" ? "Build your first agent in the next minute." : SITE.signInSubtitle}
      </p>

      <form onSubmit={submit} className="mt-8 space-y-3">
        {mode === "signup" && (
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            autoComplete="name"
            className={fieldClass}
          />
        )}
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          autoComplete="email"
          className={fieldClass}
        />
        <input
          required
          type="password"
          name="password"
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
          className={`${REPLAY_MASK_CLASS} ${fieldClass}`}
        />
        {mode === "signin" && passwordResetEnabled && (
          <div className="flex justify-end">
            <Link
              href={`/forgot-password?next=${encodeURIComponent(next)}`}
              className="min-h-11 py-2 text-sm font-semibold text-accent-dark hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        )}
        {error && <p className="text-sm text-accent-dark">{error}</p>}
        <button disabled={busy} className="btn-ink w-full disabled:opacity-60">
          {busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>

      {providers.length > 0 && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <div className="space-y-2">
            {providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                disabled={busy}
                onClick={() => continueWith(provider)}
                className="btn-ghost w-full disabled:opacity-60"
              >
                <ProviderMark id={provider.id} />
                Continue with {provider.label}
              </button>
            ))}
          </div>
        </>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        {mode === "signup" ? (
          <>
            Already have an account?{" "}
            <Link href={`/signin?next=${encodeURIComponent(next)}`} className="font-semibold text-accent-dark hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New here?{" "}
            <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-accent-dark hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </div>
  );
}

function ProviderMark({ id }: { id: string }) {
  if (id !== "google") return null;
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[18px] shrink-0">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 12 24 12c3.1 0 5.8 1.2 8 3.1l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.1 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3.1-3.5 5.6-6.6 6.8l6.3 5.3C37.4 41.3 44 36 44 24c0-1.2-.1-2.3-.4-3.5z" />
    </svg>
  );
}

function authUser(data: unknown): { id: string; email?: string; name?: string } | null {
  const root = data && typeof data === "object" && "data" in data ? (data as { data?: unknown }).data : data;
  if (!root || typeof root !== "object" || !("user" in root)) return null;
  const user = (root as { user?: unknown }).user;
  if (!user || typeof user !== "object") return null;
  const record = user as { id?: unknown; email?: unknown; name?: unknown };
  if (typeof record.id !== "string" || !record.id) return null;
  return {
    id: record.id,
    email: typeof record.email === "string" ? record.email : undefined,
    name: typeof record.name === "string" ? record.name : undefined,
  };
}
