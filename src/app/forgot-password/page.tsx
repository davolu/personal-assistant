import type { Metadata } from "next";
import { Suspense } from "react";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";
import { passwordResetEnabled } from "@/lib/auth";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <div className="dotgrid flex min-h-[70vh] items-center px-5 py-16">
      <Suspense>
        <ForgotPasswordForm enabled={passwordResetEnabled} />
      </Suspense>
    </div>
  );
}
