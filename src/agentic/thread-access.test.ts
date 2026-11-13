import assert from "node:assert/strict";
import test from "node:test";
import { threadAccess, threadAccessStatus } from "./thread-access";

test("only the owner may delete a thread", () => {
  assert.equal(threadAccess(null, "owner-a"), "unauthenticated");
  assert.equal(threadAccess("owner-a", null), "missing");
  assert.equal(threadAccess("owner-b", "owner-a"), "forbidden");
  assert.equal(threadAccess("owner-a", "owner-a"), "allowed");
  assert.equal(threadAccessStatus("unauthenticated"), 401);
  assert.equal(threadAccessStatus("missing"), 404);
  assert.equal(threadAccessStatus("forbidden"), 404);
  assert.equal(threadAccessStatus("allowed"), 200);
});
