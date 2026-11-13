import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseAskInput } from "@/agentic/ask";
import { AgenticChatView, type AgenticChatViewProps } from "./AgenticChatClient";
import { AskOptionCards, MessageList, MESSAGE_WINDOW, windowStart } from "./chat-ui";

function props(overrides: Partial<AgenticChatViewProps> = {}): AgenticChatViewProps {
  return {
    threads: [],
    signedOut: false,
    messages: [],
    ask: null,
    approval: {
      tool: "GMAIL_SEND_EMAIL",
      args: { to: "a@example.com" },
      summary: "Send the Friday recap",
    },
    connects: [],
    todos: [
      { id: "1", title: "Read the inbox", status: "done" },
      { id: "2", title: "Draft the recap", status: "in_progress" },
    ],
    verify: null,
    computer: { streamUrl: "https://example.com/desktop", sandboxId: "sb_1" },
    computerOpen: true,
    draft: "",
    editArgs: "{\n  \"to\": \"a@example.com\"\n}",
    busy: false,
    error: null,
    keyboardInset: 0,
    onNewChat: () => undefined,
    onOpenThread: () => undefined,
    onDraft: () => undefined,
    onSubmit: () => undefined,
    onToggleComputer: () => undefined,
    onEditArgs: () => undefined,
    onApprove: () => undefined,
    onEditApproval: () => undefined,
    onReject: () => undefined,
    ...overrides,
  };
}

function render(overrides: Partial<AgenticChatViewProps> = {}) {
  return renderToStaticMarkup(createElement(AgenticChatView, props(overrides)));
}

test("plan panel sits in normal flow above the composer and starts collapsed", () => {
  const html = render();
  const panel = html.indexOf("data-plan-panel");
  const composer = html.indexOf("data-composer");
  const approval = html.indexOf("data-approval-card");
  assert.ok(panel > 0 && composer > panel, "plan panel should precede the composer");
  assert.ok(approval > 0 && approval < panel, "approval card stays in the transcript above the panel");
  assert.match(html, /<details[^>]*data-plan-panel="[^"]*"[^>]*class="[^"]*lg:hidden/);
  assert.doesNotMatch(html, /<details[^>]*\sopen[\s=]/);
  assert.match(html, /data-plan-scroll="[^"]*"[^>]*class="[^"]*max-h-\[min\(40dvh,18rem\)\][^"]*overflow-y-auto/);
  assert.match(html, /Plan and computer/);
  assert.match(html, /placeholder="Ask the agent"/);
  assert.match(html, />Send</);
  assert.match(html, /safe-area-inset-bottom/);
  assert.equal(/\bfixed\b/.test(html), false);
  assert.equal(/\babsolute\b/.test(html), false);
  assert.equal(html.includes("bottom-20"), false);
});

test("approval card and desktop viewer stay in scrolling regions", () => {
  const html = render();
  const transcript = html.slice(html.indexOf("data-transcript"), html.indexOf("data-plan-panel"));
  assert.match(transcript, /data-approval-card/);
  assert.match(transcript, /Send the Friday recap/);
  assert.equal(/\bfixed\b/.test(transcript), false);

  const desktop = html.slice(html.indexOf("data-desktop-panel"));
  assert.match(desktop, /class="[^"]*\bhidden\b[^"]*\boverflow-y-auto\b[^"]*\blg:flex\b/);
  assert.match(desktop, /data-computer-frame/);
  assert.equal(/\bfixed\b/.test(desktop), false);

  const mobileScroll = html.slice(html.indexOf("data-plan-scroll"), html.indexOf("data-composer"));
  assert.match(mobileScroll, /data-computer-frame/);
  assert.match(mobileScroll, /overflow-y-auto/);
});

test("option cards are buttons, and multi-select waits for send", () => {
  const single = renderToStaticMarkup(
    createElement(AskOptionCards, {
      ask: parseAskInput({
        question: "Which list?",
        options: [
          { label: "Product team", value: "product", description: "Weekly" },
          { label: "Leadership", value: "leads" },
        ],
        allowCustom: true,
      }),
      busy: false,
      onAnswer: () => undefined,
    })
  );
  assert.match(single, /data-ask-card/);
  assert.match(single, /Which list\?/);
  assert.match(single, /data-option-card="[^"]*"[^>]*data-value="product"/);
  assert.match(single, /Weekly/);
  assert.match(single, /min-h-11/);
  assert.match(single, /data-ask-custom/);
  assert.match(single, /Send other/);
  assert.doesNotMatch(single, /aria-pressed/);

  const multi = renderToStaticMarkup(
    createElement(AskOptionCards, {
      ask: parseAskInput({
        question: "Which lists?",
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ],
        multiSelect: true,
      }),
      busy: false,
      onAnswer: () => undefined,
    })
  );
  assert.match(multi, /aria-pressed="false"/);
  assert.match(multi, /data-ask-submit/);
  assert.match(multi, /Send selection/);
  assert.doesNotMatch(multi, /data-ask-custom/);
});

test("the question, approval, and connect prompts render as cards inside the transcript", () => {
  const html = render({
    ask: {
      question: "Which list?",
      choices: ["product", "leads"],
      options: [
        { label: "Product team", value: "product", description: "Weekly" },
        { label: "Leadership", value: "leads" },
      ],
      multiSelect: false,
      allowCustom: false,
    },
    connects: [{ app: "Gmail", url: "https://example.com/connect" }],
  });
  const panel = html.indexOf("data-plan-panel");
  assert.ok(html.indexOf("data-ask-card") < panel);
  assert.ok(html.indexOf("data-connect-card") < panel);
  assert.ok(html.indexOf("data-approval-card") < panel);
  assert.match(html, /data-approve/);
  assert.match(html, /data-reject/);
  assert.match(html, />Connect</);
  assert.match(html, /placeholder="Answer the question"/);
  assert.match(html, /min-h-11/);
});

test("the user message and typing indicator appear before the agent replies", () => {
  const html = render({ pendingText: "Ship the notes", busy: true });
  assert.match(html, /data-optimistic/);
  assert.match(html, /Ship the notes/);
  assert.match(html, /data-typing/);
  assert.equal(/\bspinner\b/.test(html), false);
});

test("long threads keep a window and 44px control to reveal earlier messages", () => {
  assert.equal(windowStart(MESSAGE_WINDOW + 5, MESSAGE_WINDOW), 5);
  assert.equal(windowStart(10, MESSAGE_WINDOW), 0);
  const messages = Array.from({ length: MESSAGE_WINDOW + 3 }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    parts: [{ type: "text", text: `Line ${index}` }],
  }));
  const html = renderToStaticMarkup(createElement(MessageList, { messages }));
  assert.match(html, /data-earlier-messages/);
  assert.match(html, /min-h-11/);
  assert.equal((html.match(/Line /g) ?? []).length, MESSAGE_WINDOW);
  assert.equal(html.includes("Line 0"), false);
  assert.match(html, /Line 3/);
});

test("keyboard overlap lifts the workspace without covering the composer", () => {
  const html = render({ keyboardInset: 280 });
  assert.match(html, /data-agentic-workspace="[^"]*"[^>]*style="padding-bottom:280px"/);
  assert.match(html, /data-composer/);
  const closed = render({ keyboardInset: 0 });
  assert.doesNotMatch(closed, /padding-bottom:280px/);
  assert.match(closed, /data-composer/);
});
