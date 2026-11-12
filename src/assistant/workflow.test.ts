import assert from "node:assert/strict";
import { test } from "node:test";
import { pausedRunError, refreshKeysFromModel, replayPrompt, workflowOffer } from "./workflow";

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

test("retries of the same action collapse to the accepted plan step", () => {
  const trace = [1, 2, 3, 4].map(() => ({ tool: "GMAIL_FETCH_EMAILS", ok: true as const, effect: "read" as const, args: { query: "latest unread" } }));
  const offer = workflowOffer({
    request,
    proposal: { understanding: "List unread mail", questions: [], steps: ["List unread mail"], status: "proposed", mapped: [{ goal: "List unread mail", tool: "GMAIL_FETCH_EMAILS", toolkit: "gmail", app: "Gmail", connected: true }] },
    trace,
  });
  assert.equal(offer?.steps.length, 1);
  assert.equal(offer?.steps[0]?.goal, "List unread mail");
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

test("a saved step keeps the arguments the successful run used", () => {
  const offer = workflowOffer({
    request: "Get the latest YouTube video and post it",
    proposal: null,
    trace: [{ tool: "YOUTUBE_LIST_CHANNEL_VIDEOS", ok: true, effect: "read", args: { mine: true, channelId: "UC1", query: "latest" } }],
  });
  assert.deepEqual(offer?.steps[0]?.args, { mine: true, channelId: "UC1", query: "latest" });
  assert.deepEqual(offer?.steps[0]?.refresh, ["query"]);
  assert.deepEqual(refreshKeysFromModel('{"refresh":["channelId","missing"]}'), ["channelId", "missing"]);
  assert.equal(refreshKeysFromModel("not json"), null);
});

test("a paused agent cannot be run until it is resumed", () => {
  assert.match(pausedRunError(true) ?? "", /paused/i);
  assert.equal(pausedRunError(false), null);
});
