import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseAskInput } from "@/agentic/ask";
import { clampWidth, keyResize, nextWidthFromPointer, readPanelPrefs, resetWidth } from "@/components/panel-layout";
import { AgentList } from "./agent-list";
import { actionNotice, AgenticChatView, type AgenticChatViewProps } from "./AgenticChatClient";
import { composerKeyAction } from "./composer-key";
import { AskOptionCards, MessageList, MESSAGE_WINDOW, ModelMenuList, windowStart } from "./chat-ui";
import { safeMarkdownUrl, stabilizeStreamingMarkdown } from "./markdown";

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

test("agent rows show an icon and a menu instead of an inline rename button", () => {
  const html = renderToStaticMarkup(
    createElement(AgentList, {
      threads: [
        { id: "a", title: "Friday recap", pinned: true },
        { id: "b", title: "Inbox sweep" },
      ],
      activeId: "a",
      renamingId: null,
      renameDraft: "",
      initialMenuId: "a",
      onRenameDraft: () => undefined,
      onOpen: () => undefined,
      onRename: () => undefined,
      onStartRename: () => undefined,
      onCancelRename: () => undefined,
      onDelete: () => undefined,
      onPin: () => undefined,
      onDuplicate: () => undefined,
    })
  );
  assert.match(html, /data-agent-icon/);
  assert.match(html, /data-agent-row/);
  assert.match(html, /data-active="true"/);
  assert.match(html, /hover:bg-accent-soft/);
  assert.match(html, /active:scale-\[0\.98\]/);
  assert.match(html, /data-agent-menu-button/);
  assert.match(html, /role="menu"/);
  assert.match(html, /Rename/);
  assert.match(html, /Delete/);
  assert.match(html, /Pin to top|Unpin/);
  assert.match(html, /Duplicate/);
  assert.match(html, /role="menuitem"/);
});

test("action notices stay short and do not name a model", () => {
  for (const decision of ["approve", "edit", "reject", "connect", "send the friday recap"]) {
    const text = actionNotice(decision);
    assert.ok(text.length < 40);
    assert.doesNotMatch(text, /claude|gpt|gemini|model/i);
  }
  assert.equal(actionNotice("approve"), "Approved");
  assert.equal(actionNotice("reject"), "Rejected");
  assert.equal(actionNotice("connect"), "Connected");
  assert.equal(actionNotice("send the friday recap"), "Answer sent");
});

test("the chat header can save a schedule without naming a model", () => {
  const html = render({ threads: [{ id: "t1", title: "Friday recap" }] });
  assert.match(html, /data-schedule-action/);
  assert.match(html, />Schedule</);
  assert.doesNotMatch(html, /Claude decides/);
});

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
  assert.match(html, /placeholder="Message your Autonomous Agent"/);
  assert.match(html, />Send</);
  assert.match(html, /safe-area-inset-bottom/);
  assert.equal(/\bfixed\b/.test(html), false);
  assert.equal(/\babsolute\b/.test(html), false);
  assert.equal(html.includes("bottom-20"), false);
});

test("the desktop frame is tied to the current sandbox and a cleared stream is not shown", () => {
  const live = render();
  assert.match(live, /data-sandbox="sb_1"/);
  assert.match(live, /src="https:\/\/example.com\/desktop"/);
  const cleared = render({ computer: { streamUrl: "", sandboxId: "sb_old" } });
  assert.doesNotMatch(cleared, /data-computer-frame/);
  assert.doesNotMatch(cleared, /sb_old/);
  assert.doesNotMatch(cleared, />Live</);
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

test("the budget question offers keep going and stop, and a failed resume can be retried", () => {
  const html = render({
    approval: null,
    ask: {
      id: "budget-1",
      question: "This turn reached its active time budget. So far I used web_search. How should I continue?",
      choices: ["continue", "stop"],
      options: [
        { label: "Keep going", value: "continue", description: "Reset the timer and keep working on this task." },
        { label: "Stop here", value: "stop", description: "End this turn and keep what is already done." },
      ],
      multiSelect: false,
      allowCustom: true,
    },
    settled: { "budget-1": { status: "pending", error: "That could not be completed. It is still waiting, so you can try again." } },
    resolvingId: "budget-1",
    resumeNote: "Continuing…",
    onRetry: () => undefined,
  });
  assert.match(html, /data-budget-ask="true"/);
  assert.match(html, /Keep going/);
  assert.match(html, /Stop here/);
  assert.match(html, /Reset the timer/);
  assert.match(html, /data-primary="true"/);
  assert.match(html, /data-value="continue"/);
  assert.match(html, /data-ask-custom/);
  assert.match(html, /data-ask-retry/);
  assert.match(html, />Retry</);
  assert.match(html, /data-resume-progress/);
  assert.match(html, /Continuing…/);
  assert.match(html, /data-typing/);
  assert.match(html, /placeholder="Answer the question"/);
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

test("models without a provider key are disabled with no key prompt", () => {
  const html = renderToStaticMarkup(
    createElement(ModelMenuList, {
      value: "claude-sonnet",
      onChange: () => undefined,
      models: [
        {
          id: "claude-sonnet",
          provider: "anthropic",
          label: "Claude Sonnet",
          model: "claude-sonnet-4-5",
          env: "ANTHROPIC_API_KEY",
          available: true,
          capabilities: { tools: true, thinking: true, computer: true, promptCache: true },
        },
        {
          id: "gpt-4.1",
          provider: "openai",
          label: "GPT-4.1",
          model: "gpt-4.1",
          env: "OPENAI_API_KEY",
          available: false,
          capabilities: { tools: true, thinking: false, computer: false, promptCache: false },
        },
      ],
    })
  );
  const claude = html.slice(html.indexOf('data-model-id="claude-sonnet"'), html.indexOf("</button>"));
  const gpt = html.slice(html.indexOf('data-model-id="gpt-4.1"'), html.indexOf('data-model-id="gpt-4.1"') + 500);
  assert.equal(/\sdisabled(?:=|\s|>)/.test(claude), false);
  assert.match(claude, /title="Claude Sonnet"/);
  assert.match(gpt, /\sdisabled(?:=|\s|>)/);
  assert.match(gpt, /aria-disabled="true"/);
  assert.match(gpt, /data-available="false"/);
  assert.match(gpt, /opacity-50/);
  assert.match(gpt, />GPT-4\.1</);
  assert.equal(/title=/.test(gpt), false);
  assert.equal(/API key|OPENAI_API_KEY|Needs |Requires key|coming soon|Add API/i.test(gpt), false);
  assert.match(gpt, /min-h-11/);
});

test("a plan-locked model is greyed out without a needs-key label", () => {
  const html = renderToStaticMarkup(
    createElement(ModelMenuList, {
      value: null,
      onChange: () => undefined,
      models: [
        {
          id: "claude-haiku",
          provider: "anthropic",
          label: "Haiku",
          model: "claude-haiku-5-5",
          env: "ANTHROPIC_API_KEY",
          available: true,
          locked: false,
          hint: "Fast",
          capabilities: { tools: true, thinking: true, computer: true, promptCache: true },
        },
        {
          id: "claude-opus",
          provider: "anthropic",
          label: "Opus",
          model: "claude-opus-5-5",
          env: "ANTHROPIC_API_KEY",
          available: true,
          locked: true,
          hint: "Deep",
          capabilities: { tools: true, thinking: true, computer: true, promptCache: true },
        },
      ],
    })
  );
  const opus = html.slice(html.indexOf('data-model-id="claude-opus"'), html.indexOf('data-model-id="claude-opus"') + 700);
  assert.match(opus, /data-locked="true"/);
  assert.match(opus, /\sdisabled(?:=|\s|>)/);
  assert.equal(opus.includes("Needs "), false);
  assert.match(opus, /Deep/);
});

test("desktop panels expose collapse toggles and resize handles", () => {
  const html = render();
  assert.match(html, /aria-label="Collapse chats"/);
  assert.match(html, /aria-label="Resize chats"/);
  assert.match(html, /aria-label="Collapse plan and computer"/);
  assert.match(html, /aria-label="Resize plan and computer"/);
  assert.match(html, /role="separator"/);
  assert.match(html, /aria-orientation="vertical"/);
  assert.match(html, /aria-expanded="true"/);
  assert.equal(/\bfixed\b/.test(html), false);
  assert.equal(/\babsolute\b/.test(html), false);
});

test("an empty composer cannot send, and a running turn offers stop", () => {
  const idle = render();
  const composer = idle.slice(idle.indexOf("data-composer"));
  assert.match(composer, /placeholder="Message your Autonomous Agent"/);
  assert.match(composer, />Send</);
  assert.match(composer, /<button[^>]*disabled/);
  assert.match(composer, /safe-area-inset-bottom/);

  const running = render({ busy: true, draft: "Still typing" });
  const live = running.slice(running.indexOf("data-composer"));
  assert.match(live, /aria-label="Stop the agent"/);
  assert.match(live, />Stop</);
  assert.equal(/<button[^>]*disabled/.test(live), false);
  assert.equal(/\bspinner\b/.test(running), false);
});

test("assistant messages render markdown and ignore raw html", () => {
  const html = renderToStaticMarkup(
    createElement(MessageList, {
      messages: [
        { id: "u", role: "user", parts: [{ type: "text", text: "**not bold**" }] },
        {
          id: "a",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "### Plan\n\n**Ready** to go\n\n- one\n\n`code`\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n[docs](https://example.com/docs)\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>",
            },
          ],
        },
      ],
    })
  );
  assert.match(html, /\*\*not bold\*\*/);
  assert.equal(html.includes("<strong>not bold</strong>"), false);
  assert.match(html, /<h3>Plan<\/h3>/);
  assert.match(html, /<strong>Ready<\/strong>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<table>/);
  assert.match(html, /<a href="https:\/\/example.com\/docs" target="_blank" rel="noopener noreferrer">/);
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("onerror"), false);
});

test("a partial code fence is closed so later text stays outside the block", () => {
  const open = stabilizeStreamingMarkdown("```ts\nconst x = 1");
  assert.equal((open.match(/```/g) ?? []).length % 2, 0);
  const closed = stabilizeStreamingMarkdown("Hello `code` there");
  assert.equal(closed, "Hello `code` there");
  const partial = stabilizeStreamingMarkdown("Use `code");
  assert.equal(partial, "Use `code`");
  assert.equal(safeMarkdownUrl("javascript:alert(1)"), "");
  assert.equal(safeMarkdownUrl("https://example.com"), "https://example.com");
});

test("panel width math clamps, remembers collapse, and arrow keys follow the edge", () => {
  assert.equal(clampWidth(12, 160, 360), 160);
  assert.equal(clampWidth(900, 160, 360), 360);
  assert.equal(clampWidth(Number.NaN, 160, 360), 160);
  assert.deepEqual(readPanelPrefs(null, { width: 208, collapsed: false }, 160, 360), { width: 208, collapsed: false });
  assert.deepEqual(readPanelPrefs("{", { width: 208, collapsed: false }, 160, 360), { width: 208, collapsed: false });
  assert.deepEqual(readPanelPrefs(JSON.stringify({ width: 40, collapsed: true }), { width: 208, collapsed: false }, 160, 360), {
    width: 160,
    collapsed: true,
  });
  assert.equal(nextWidthFromPointer(200, 30, "right", 160, 360), 230);
  assert.equal(nextWidthFromPointer(200, 30, "left", 160, 360), 170);
  assert.equal(keyResize(200, "ArrowRight", "right", 160, 360, false), 216);
  assert.equal(keyResize(200, "ArrowLeft", "left", 160, 360, false), 216);
  assert.equal(keyResize(200, "ArrowLeft", "right", 160, 360, true), 160);
  assert.equal(keyResize(200, "Home", "right", 160, 360, false), 160);
  assert.equal(keyResize(200, "End", "left", 220, 520, false), 520);
  assert.equal(keyResize(200, "Enter", "right", 160, 360, false), null);
  assert.equal(resetWidth(288, 220, 520), 288);
});

test("enter sends, and shift, composition, or a running turn do not", () => {
  assert.equal(composerKeyAction("Enter", false, false, false), "send");
  assert.equal(composerKeyAction("Enter", true, false, false), "ignore");
  assert.equal(composerKeyAction("Enter", false, true, false), "ignore");
  assert.equal(composerKeyAction("Enter", false, false, true), "ignore");
  assert.equal(composerKeyAction("a", false, false, false), "ignore");
});

test("keyboard overlap marks the workspace open without padding the composer out of view", () => {
  const html = render({ keyboardInset: 280 });
  assert.match(html, /data-keyboard-open="true"/);
  assert.match(html, /data-composer/);
  assert.doesNotMatch(html, /padding-bottom:280px/);
  const closed = render({ keyboardInset: 0 });
  assert.match(closed, /data-keyboard-open="false"/);
  assert.match(closed, /data-composer/);
});

test("mobile chat uses one app bar and keeps the desktop header", () => {
  const html = render({ title: "Friday recap", activeId: "t1", threads: [{ id: "t1", title: "Friday recap" }] });
  assert.match(html, /data-mobile-appbar/);
  assert.match(html, /data-agents-button/);
  assert.match(html, /aria-label="Your agents"/);
  assert.match(html, /data-overflow-button/);
  assert.match(html, /data-plan-button/);
  assert.match(html, /data-plan-badge/);
  assert.match(html, /aria-label="Plan and computer"/);
  assert.doesNotMatch(html, /data-mobile-agents/);
  const mobile = html.slice(html.indexOf("data-mobile-appbar"), html.indexOf("data-desktop-header"));
  assert.match(mobile, /Friday recap/);
  assert.doesNotMatch(mobile, /A truly autonomous agent/);
  const desktop = html.slice(html.indexOf("data-desktop-header"), html.indexOf("data-transcript"));
  assert.match(desktop, /class="[^"]*\bhidden\b[^"]*\bmd:flex\b/);
  assert.match(desktop, /A truly autonomous agent/);
  assert.match(desktop, /data-schedule-action/);
  assert.match(html, /data-plan-panel="[^"]*"[^>]*class="[^"]*\bhidden\b[^"]*\bmd:block\b[^"]*\blg:hidden/);
  const quiet = render({ title: "New chat", todos: [], computer: null, approval: null });
  assert.doesNotMatch(quiet, /data-plan-badge/);
});
