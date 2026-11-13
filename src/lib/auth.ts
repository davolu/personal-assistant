import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { authBaseURL } from "@/lib/auth-base-url";
import { sendEmail, mailerConfigured, passwordResetMessage } from "@/lib/email";
import { PASSWORD_RESET_TOKEN_SECONDS, passwordResetEmailUrl } from "@/lib/password-reset";
import { prisma } from "@/lib/prisma";
import { accountLinkingOptions, enabledSocialProviders as resolveSocialProviders, socialProviderOptions } from "@/lib/social-providers";
import { trustedAuthOrigins } from "@/lib/trusted-origins";

export const enabledSocialProviders = resolveSocialProviders();
export const passwordResetEnabled = mailerConfigured();

if (!passwordResetEnabled) {
  console.warn("[email] Forgot password is hidden. Set RESEND_API_KEY and EMAIL_FROM to send reset links.");
}

export const auth = betterAuth({
  baseURL: authBaseURL(),
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
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
