import assert from "node:assert/strict";
import test from "node:test";
import { previewBlocks, sanitizeHtml } from "./html-preview";

test("email html is formatted and scripts are removed", () => {
  const html = sanitizeHtml('<p>Hello <strong>team</strong></p><script>alert(1)</script><a href="javascript:alert(1)">x</a><a href="https://example.com">site</a>');
  assert.match(html, /<p>Hello <strong>team<\/strong><\/p>/);
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("javascript:"), false);
  assert.match(html, /href="https:\/\/example.com"/);
  const blocks = previewBlocks({ body: "<p>Running <b>late</b></p>", to: "a@example.com" });
  assert.equal(blocks.some((block) => block.html?.includes("<b>late</b>")), true);
  assert.equal(blocks.some((block) => block.text === "a@example.com"), true);
});
