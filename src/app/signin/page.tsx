import type { Metadata } from "next";
import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";
import { enabledSocialProviders, passwordResetEnabled } from "@/lib/auth";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="dotgrid flex min-h-[70vh] items-center px-5 py-16">
      <Suspense>
        <AuthForm mode="signin" providers={enabledSocialProviders} passwordResetEnabled={passwordResetEnabled} />
      </Suspense>
    </div>
  );
}
