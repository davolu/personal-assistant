import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantMessage } from "./AssistantMessage";

test("assistant replies render markdown and do not show raw stars or html", () => {
  const html = renderToStaticMarkup(
    createElement(AssistantMessage, { text: "**Subject:** Hello\n\n- one\n\n<script>alert(1)</script>" })
  );
  assert.match(html, /<strong>Subject:<\/strong>/);
  assert.match(html, /<li>one<\/li>/);
  assert.equal(html.includes("**"), false);
  assert.equal(html.includes("<script"), false);
});
