import assert from "node:assert/strict";
import test from "node:test";
import { isComposioConnectUrl, sameApp } from "./connect-url";

test("app names match by slug without a catalog", () => {
  assert.equal(sameApp("Google Calendar", "googlecalendar"), true);
  assert.equal(sameApp("Notion", "notion"), true);
  assert.equal(sameApp("Gmail", "slack"), false);
});

test("only Composio auth hosts count as connect urls", () => {
  assert.equal(isComposioConnectUrl("https://connect.composio.dev/link/abc"), true);
  assert.equal(isComposioConnectUrl("https://example.com/approvals"), false);
  assert.equal(isComposioConnectUrl("javascript:alert(1)"), false);
});
