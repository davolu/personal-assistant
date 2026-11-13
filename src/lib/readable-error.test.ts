import assert from "node:assert/strict";
import { test } from "node:test";
import { isSignInError, readableError } from "./readable-error";

test("API error JSON becomes the message inside it", () => {
  assert.equal(readableError('{"error":"Agent not found"}'), "Agent not found");
  assert.equal(readableError('{"error":"Sign in first"}'), "Sign in to continue.");
  assert.equal(isSignInError('{"error":"Sign in first"}'), true);
});

test("unreadable payloads do not render as JSON", () => {
  assert.equal(readableError('{"oops":true}'), "Something went wrong. Try again.");
  assert.equal(readableError("not json {"), "not json {");
  assert.equal(readableError(""), "Something went wrong. Try again.");
});
