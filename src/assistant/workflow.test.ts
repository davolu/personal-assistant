import assert from "node:assert/strict";
import { test } from "node:test";
import { replayPrompt, workflowOffer } from "./workflow";

const request = "Show my unread emails";

test("a successful tool run can be saved, and a failed one cannot", () => {
  const offer = workflowOffer({
    request,
    proposal: null,
    trace: [{ tool: "GMAIL_FETCH_EMAILS", ok: true, effect: "read", args: { query: "latest unread" } }],
  });
  assert.equal(offer?.steps[0]?.tool, "GMAIL_FETCH_EMAILS");
  assert.deepEqual(offer?.steps[0]?.refresh, ["query"]);
  assert.equal(offer?.cadence, "manual");
  assert.equal(
    workflowOffer({
      request,
      proposal: null,
      trace: [{ tool: "GMAIL_FETCH_EMAILS", ok: false, effect: "read", args: {} }],
    }),
    null
  );
  assert.equal(workflowOffer({ request, proposal: null, trace: [] }), null);
});

test("a daily request suggests a daily schedule and replay keeps relative instructions", () => {
  const offer = workflowOffer({
    request: "Check unread email every day",
    proposal: null,
    trace: [{ tool: "GMAIL_FETCH_EMAILS", ok: true, effect: "read", args: { query: "latest unread" } }],
  });
  assert.equal(offer?.cadence, "daily");
  const prompt = replayPrompt(offer!);
  assert.match(prompt, /GMAIL_FETCH_EMAILS/);
  assert.match(prompt, /Refresh these each run/);
  assert.doesNotMatch(prompt, /latest unread/);
});
