import type { Metadata } from "next";
import { Suspense } from "react";
import AuthForm from "@/components/AuthForm";
import { enabledSocialProviders, passwordResetEnabled } from "@/lib/auth";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <div className="dotgrid flex min-h-[70vh] items-center px-5 py-16">
      <Suspense>
        <AuthForm mode="signup" providers={enabledSocialProviders} passwordResetEnabled={passwordResetEnabled} />
      </Suspense>
    </div>
  );
}
