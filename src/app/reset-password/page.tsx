import type { Metadata } from "next";
import { Suspense } from "react";
import ResetPasswordForm from "@/components/ResetPasswordForm";
import { passwordResetEnabled } from "@/lib/auth";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <div className="dotgrid flex min-h-[70vh] items-center px-5 py-16">
      <Suspense>
        <ResetPasswordForm passwordResetEnabled={passwordResetEnabled} />
      </Suspense>
    </div>
  );
}
