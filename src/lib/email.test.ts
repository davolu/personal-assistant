import assert from "node:assert/strict";
import { test } from "node:test";
import { mailerConfigured, passwordResetMessage, sendEmail } from "./email";

test("the mailer is configured only when both env vars are set", () => {
  assert.equal(mailerConfigured({}), false);
  assert.equal(mailerConfigured({ RESEND_API_KEY: "re_test" }), false);
  assert.equal(mailerConfigured({ EMAIL_FROM: "AgentDocker <noreply@agentdocker.io>" }), false);
  assert.equal(
    mailerConfigured({ RESEND_API_KEY: "re_test", EMAIL_FROM: "AgentDocker <noreply@agentdocker.io>" }),
    true,
  );
});

test("an unconfigured mailer logs and does not throw", async () => {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    await sendEmail(
      { to: "ada@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi" },
      {},
    );
  } finally {
    console.warn = original;
  }
  assert.match(warnings.map((line) => line.join(" ")).join("\n"), /RESEND_API_KEY or EMAIL_FROM/);
});

test("the reset email is branded text and html and does not name a model", () => {
  const message = passwordResetMessage({
    to: "ada@example.com",
    name: "Ada <script>",
    url: "https://www.agentdocker.io/api/auth/reset-password/tok_123?callbackURL=%2Freset-password",
  });
  assert.equal(message.to, "ada@example.com");
  assert.match(message.subject, /AgentDocker/);
  assert.match(message.text, /https:\/\/www\.agentdocker\.io\/api\/auth\/reset-password\/tok_123/);
  assert.match(message.html, /#f3f1ea/);
  assert.match(message.html, /#3e5cd6/);
  assert.match(message.html, /Choose a new password/);
  assert.match(message.html, /Ada &lt;script&gt;/);
  assert.doesNotMatch(message.html, /<script>/);
  const combined = `${message.subject}\n${message.text}\n${message.html}`;
  assert.doesNotMatch(combined, /\b(claude|gpt-?[0-9]|gemini|llama|mistral|anthropic|openai)\b/i);
});
