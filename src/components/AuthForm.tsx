"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function AuthForm({
  mode,
  googleEnabled,
}: {
  mode: "signin" | "signup";
  googleEnabled: boolean;
}) {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/dashboard";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const res =
      mode === "signup"
        ? await authClient.signUp.email({ name, email, password })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (res.error) {
      setError(res.error.message || "Something went wrong — try again.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  async function google() {
    await authClient.signIn.social({ provider: "google", callbackURL: next });
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="text-center text-3xl font-bold tracking-tight">
        {mode === "signup" ? "Create your account" : "Welcome back"}
      </h1>
      <p className="mt-2 text-center text-sm text-muted">
        {mode === "signup"
          ? "Hire your first agent in the next minute."
          : "Sign in to manage your agents."}
      </p>

      <form onSubmit={submit} className="mt-8 space-y-3">
        {mode === "signup" && (
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-xl border border-line bg-panel px-4 py-3 text-[15px] outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        )}
        <input
          required
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email address"
          className="w-full rounded-xl border border-line bg-panel px-4 py-3 text-[15px] outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <input
          required
          type="password"
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "signup" ? "Password (8+ characters)" : "Password"}
          className="w-full rounded-xl border border-line bg-panel px-4 py-3 text-[15px] outline-none placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        {error && <p className="text-sm text-accent-dark">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-xl bg-accent py-3.5 font-semibold text-white shadow-lg shadow-accent/25 transition hover:bg-accent-dark disabled:opacity-60"
        >
          {busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>

      {googleEnabled && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
          <button
            onClick={google}
            className="w-full rounded-xl border border-line bg-panel py-3 font-semibold transition hover:border-ink/30"
          >
            Continue with Google
          </button>
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
