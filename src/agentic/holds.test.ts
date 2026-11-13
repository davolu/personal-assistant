import assert from "node:assert/strict";
import test from "node:test";
import { decisionLabel, normalizeResolution, parkedHoldPause, planTurn, publicError, resolutionEventName, stableHoldId } from "./holds";

test("a chat message does not approve or answer a waiting card", () => {
  const approval = planTurn({ interrupted: true, interruptValue: { kind: "approval", digest: "abc" }, text: "send it to someone else" });
  assert.equal(approval.mode, "defer");
  if (approval.mode === "defer") {
    assert.equal(approval.resume.defer, true);
    assert.equal(approval.resume.text, "send it to someone else");
    assert.equal(approval.resume.id, "abc");
  }
  const ask = planTurn({ interrupted: true, interruptValue: { kind: "ask", question: "Which one?" }, text: "actually, draft it in chat" });
  assert.equal(ask.mode, "defer");
  const fresh = planTurn({ interrupted: false, text: "hello" });
  assert.deepEqual(fresh, { mode: "message", text: "hello" });
});

test("an explicit decision resolves the waiting card", () => {
  const planned = planTurn({
    interrupted: false,
    text: "",
    resolve: { id: "card-1", decision: "approve" },
  });
  assert.equal(planned.mode, "resolve");
  if (planned.mode === "resolve") assert.equal(planned.resolution.decision, "approve");
  const legacy = planTurn({
    interrupted: true,
    interruptValue: { kind: "approval", toolUseId: "call-1" },
    text: "",
    resolve: { id: "call-1", decision: "reject" },
  });
  assert.equal(legacy.mode, "legacy");
});

test("approval labels stay generic", () => {
  assert.equal(decisionLabel("approval", { decision: "approve" }), "Approved");
  assert.equal(decisionLabel("approval", { decision: "edit" }), "Edited and approved");
  assert.equal(decisionLabel("approval", { decision: "reject" }), "Rejected");
  assert.equal(decisionLabel("ask", { selected: ["Product", "Leads"] }), "Product, Leads");
  assert.equal(decisionLabel("connect", { connected: true }), "Connected");
  const parsed = normalizeResolution("approval", { decision: "edit", args: { to: "a@example.com" } });
  assert.equal(parsed.defer, false);
  assert.equal(parsed.decision, "edit");
  assert.deepEqual(parsed.args, { to: "a@example.com" });
});

test("a parked budget question is a hold the durable worker can resume", () => {
  assert.equal(resolutionEventName({ kind: "ask", decision: "continue" }), "agentic/ask.answered");
  assert.equal(resolutionEventName({ kind: "approval", decision: "approve" }), "agentic/approval.resolved");
  assert.equal(resolutionEventName({ decision: "stop" }), "agentic/ask.answered");
  const pause = parkedHoldPause(
    [{ id: "ask-1", kind: "ask", status: "pending", at: 1, toolUseId: "ask-1", budget: true }],
    null
  );
  assert.equal(pause?.via, "hold");
  assert.equal(pause?.budget, true);
  assert.equal(pause?.id, "ask-1");
  assert.equal(parkedHoldPause([], { kind: "approval", id: "call-1" })?.via, "interrupt");
});

test("a missing column becomes a retryable message", () => {
  const text = publicError(new Error('column "user_id" does not exist'));
  assert.match(text, /still waiting/);
  assert.equal(text.includes("user_id"), false);
  assert.equal(stableHoldId({ kind: "approval", digest: "digest-1" }), "digest-1");
});
