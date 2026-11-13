type Env = Record<string, string | undefined>;

export type OutboundEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function envValue(env: Env, key: string): string {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
}

export function mailerConfigured(env: Env = process.env): boolean {
  return Boolean(envValue(env, "RESEND_API_KEY") && envValue(env, "EMAIL_FROM"));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function passwordResetMessage(input: { to: string; url: string; name?: string | null }): OutboundEmail {
  const url = input.url.trim();
  const safeUrl = escapeHtml(url);
  const name = (input.name ?? "").trim();
  const greeting = name ? `Hi ${name},` : "Hi,";
  const safeGreeting = escapeHtml(greeting);
  const subject = "Reset your AgentDocker password";
  const text = [
    greeting,
    "",
    "We received a request to reset the password for this AgentDocker account.",
    "The link expires in one hour.",
    "",
    url,
    "",
    "If you didn't ask for this, you can ignore this email. Your password stays the same.",
    "",
    "AgentDocker",
    "https://agentdocker.io",
  ].join("\n");
  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f1ea;color:#1a1916;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f1ea;padding:32px 16px;font-family:'Proxima Nova','Helvetica Neue',Helvetica,Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#fffdf8;border:1px solid #c8bfb0;border-radius:24px;overflow:hidden;">
            <tr><td style="height:8px;background:#3e5cd6;font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr>
              <td style="padding:32px 28px 28px;">
                <p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#1e3a9c;">AgentDocker</p>
                <h1 style="margin:0 0 12px;font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-0.045em;color:#1a1916;">Reset your password</h1>
                <p style="margin:0 0 8px;font-size:16px;line-height:1.5;color:#1a1916;">${safeGreeting}</p>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#534f48;">We received a request to reset the password for this AgentDocker account. This link expires in one hour.</p>
                <a href="${safeUrl}" style="display:inline-block;background:#3e5cd6;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;line-height:1;padding:14px 22px;border-radius:999px;">Choose a new password</a>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#534f48;">If you didn't ask for this, you can ignore this email. Your password stays the same.</p>
                <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#534f48;word-break:break-all;">${safeUrl}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { to: input.to, subject, html, text };
}

export function verificationEmail(input: { to: string; url: string; name?: string | null }): OutboundEmail {
  const url = input.url.trim();
  const safeUrl = escapeHtml(url);
  const name = (input.name ?? "").trim();
  const greeting = name ? `Hi ${name},` : "Hi,";
  const subject = "Verify your AgentDocker email";
  const text = [
    greeting,
    "",
    "Verify this email so free credits can be used on AgentDocker.",
    "",
    url,
    "",
    "If you didn't create this account, you can ignore this email.",
    "",
    "AgentDocker",
    "https://agentdocker.io",
  ].join("\n");
  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f3f1ea;color:#1a1916;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f1ea;padding:32px 16px;font-family:'Proxima Nova','Helvetica Neue',Helvetica,Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px;background:#fffdf8;border:1px solid #c8bfb0;border-radius:24px;overflow:hidden;">
            <tr><td style="height:8px;background:#3e5cd6;font-size:0;line-height:0;">&nbsp;</td></tr>
            <tr>
              <td style="padding:32px 28px 28px;">
                <p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#1e3a9c;">AgentDocker</p>
                <h1 style="margin:0 0 12px;font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-0.045em;color:#1a1916;">Verify your email</h1>
                <p style="margin:0 0 8px;font-size:16px;line-height:1.5;color:#1a1916;">${escapeHtml(greeting)}</p>
                <p style="margin:0 0 24px;font-size:16px;line-height:1.5;color:#534f48;">Verify this email so free credits can be used. The link expires in one hour.</p>
                <a href="${safeUrl}" style="display:inline-block;background:#3e5cd6;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;line-height:1;padding:14px 22px;border-radius:999px;">Verify email</a>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#534f48;">If you didn't create this account, you can ignore this email.</p>
                <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:#534f48;word-break:break-all;">${safeUrl}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  return { to: input.to, subject, html, text };
}

export async function sendEmail(message: OutboundEmail, env: Env = process.env): Promise<void> {
  if (!mailerConfigured(env)) {
    console.warn("[email] RESEND_API_KEY or EMAIL_FROM is unset. Skipping send.");
    return;
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${envValue(env, "RESEND_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: envValue(env, "EMAIL_FROM"),
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    console.error(`[email] Resend returned ${response.status}`);
    throw new Error("Email provider rejected the message");
  }
}
