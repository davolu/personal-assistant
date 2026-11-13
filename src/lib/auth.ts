import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { authBaseURL } from "@/lib/auth-base-url";
import { mailerConfigured, passwordResetMessage, sendEmail, verificationEmail } from "@/lib/email";
import { PASSWORD_RESET_TOKEN_SECONDS, passwordResetEmailUrl } from "@/lib/password-reset";
import { prisma } from "@/lib/prisma";
import { accountLinkingOptions, enabledSocialProviders as resolveSocialProviders, socialProviderOptions } from "@/lib/social-providers";
import { trustedAuthOrigins } from "@/lib/trusted-origins";

export const enabledSocialProviders = resolveSocialProviders();
export const passwordResetEnabled = mailerConfigured();
export const emailVerificationEnabled = mailerConfigured();

if (!passwordResetEnabled) {
  console.warn("[email] Forgot password is hidden and free credits require Google sign-in. Set RESEND_API_KEY and EMAIL_FROM.");
}

export const auth = betterAuth({
  baseURL: authBaseURL(),
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: emailVerificationEnabled,
    autoSignIn: !emailVerificationEnabled,
    resetPasswordTokenExpiresIn: PASSWORD_RESET_TOKEN_SECONDS,
    revokeSessionsOnPasswordReset: true,
    ...(passwordResetEnabled
      ? {
          sendResetPassword: async ({ user, url }, request) => {
            const link = passwordResetEmailUrl({ url, request });
            try {
              await sendEmail(passwordResetMessage({ to: user.email, name: user.name, url: link }));
            } catch (error) {
              console.error("[email] Password reset email failed", error instanceof Error ? error.message : "unknown error");
            }
          },
        }
      : {}),
  },
  emailVerification: emailVerificationEnabled
    ? {
        sendOnSignUp: true,
        autoSignInAfterVerification: true,
        sendVerificationEmail: async ({ user, url }) => {
          try {
            await sendEmail(verificationEmail({ to: user.email, name: user.name, url }));
          } catch (error) {
            console.error("[email] Verification email failed", error instanceof Error ? error.message : "unknown error");
          }
        },
      }
    : undefined,
  socialProviders: socialProviderOptions(),
  account: {
    accountLinking: accountLinkingOptions(),
  },
  session: {
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  advanced: {
    // Vercel sets x-forwarded-host to the host the browser used. allowedHosts
    // still rejects anything outside the sign-in allowlist.
    trustedProxyHeaders: true,
  },
  // CSRF stays on. These origins are the only ones that may sign in or sign up.
  trustedOrigins: trustedAuthOrigins(),
});
