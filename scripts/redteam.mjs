// Deterministic safety checks for the effect gate (Ch50).
// Run: node scripts/redteam.mjs  — exits non-zero on any failure.
// These are release-gate tests: run before every deploy.

import { classifyEffect, gateDecision } from "../src/lib/effects.ts";

let failures = 0;
function expect(name, actual, wanted) {
  const ok = actual === wanted;
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗ FAIL"} ${name}: ${actual}${ok ? "" : ` (wanted ${wanted})`}`);
}

// --- Classification: external effects are recognized regardless of app ---
for (const t of [
  "GMAIL_SEND_EMAIL",
  "SLACK_CHAT_POST_MESSAGE",
  "INSTAGRAM_CREATE_POST",
  "GMAIL_REPLY_TO_THREAD",
  "NOTION_DELETE_BLOCK",
  "GOOGLEDRIVE_TRASH_FILE",
  "STRIPE_CREATE_REFUND",
  "TWILIO_SEND_SMS",
]) {
  expect(`external: ${t}`, classifyEffect(t), "external");
}

// --- Reads stay reads ---
for (const t of ["GMAIL_FETCH_EMAILS", "SLACK_FIND_CHANNELS", "NOTION_SEARCH_NOTION_PAGE", "COMPOSIO_SEARCH_TAVILY"]) {
  expect(`read: ${t}`, classifyEffect(t), "read");
}

// --- Internal writes ---
for (const t of ["GOOGLESHEETS_BATCH_UPDATE", "NOTION_CREATE_NOTION_PAGE", "CANVA_CREATE_DESIGN_EXPORT_JOB"]) {
  expect(`write_internal: ${t}`, classifyEffect(t), "write_internal");
}

// --- Gate: ask-first holds external, auto executes it ---
expect("ask-first holds send", gateDecision("GMAIL_SEND_EMAIL", "approve"), "hold");
expect("auto executes send", gateDecision("GMAIL_SEND_EMAIL", "auto"), "execute");
expect("reads execute in ask-first", gateDecision("GMAIL_FETCH_EMAILS", "approve"), "execute");
expect("internal writes execute in ask-first", gateDecision("GOOGLESHEETS_BATCH_UPDATE", "approve"), "execute");

// --- Unknown class NEVER auto-executes, in any mode (deny by default) ---
expect("unknown held in auto", gateDecision("WEIRDAPP_FLURB_THE_WIDGET", "auto"), "hold");
expect("unknown held in ask-first", gateDecision("WEIRDAPP_FLURB_THE_WIDGET", "approve"), "hold");

// --- Injection resistance: decisions depend only on slug + mode.
// Simulate an injected instruction trying to smuggle permissions via content:
// there is no content parameter at all — the API makes the attack unrepresentable.
const before = gateDecision("GMAIL_SEND_EMAIL", "approve");
const after = gateDecision("GMAIL_SEND_EMAIL", "approve"); // nothing an email says can change this
expect("gate is content-blind", `${before}=${after}`, "hold=hold");

console.log(failures === 0 ? "\nALL SAFETY CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
