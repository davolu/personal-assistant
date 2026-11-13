import assert from "node:assert/strict";
import { test } from "node:test";
import { explainAuthError, ORIGIN_REJECTED_MESSAGE, withClearerOriginError } from "./auth-error";

test("invalid origin becomes a message that names the allowed addresses", () => {
  assert.equal(explainAuthError("Invalid origin"), ORIGIN_REJECTED_MESSAGE);
  assert.equal(explainAuthError("invalid origin"), ORIGIN_REJECTED_MESSAGE);
  assert.equal(explainAuthError("", "INVALID_ORIGIN"), ORIGIN_REJECTED_MESSAGE);
  assert.equal(explainAuthError("Missing or null Origin"), ORIGIN_REJECTED_MESSAGE);
  assert.match(ORIGIN_REJECTED_MESSAGE, /production/i);
  assert.match(ORIGIN_REJECTED_MESSAGE, /preview/i);
  assert.match(ORIGIN_REJECTED_MESSAGE, /localhost/i);
  assert.doesNotMatch(ORIGIN_REJECTED_MESSAGE, /^Invalid origin$/);
});

test("other auth errors are left unchanged", () => {
  assert.equal(explainAuthError("Invalid email or password"), "Invalid email or password");
  assert.equal(explainAuthError("  Password too short  "), "Password too short");
  assert.equal(explainAuthError(""), "Something went wrong — try again.");
  assert.equal(explainAuthError(null, null), "Something went wrong — try again.");
});

test("only a 403 origin rejection is rewritten", async () => {
  const rejected = await withClearerOriginError(
    Response.json({ message: "Invalid origin", code: "INVALID_ORIGIN" }, { status: 403 }),
  );
  assert.equal(rejected.status, 403);
  const body = (await rejected.json()) as { message: string; code: string };
  assert.equal(body.message, ORIGIN_REJECTED_MESSAGE);
  assert.equal(body.code, "INVALID_ORIGIN");

  const password = await withClearerOriginError(
    Response.json({ message: "Invalid email or password", code: "INVALID_EMAIL_OR_PASSWORD" }, { status: 401 }),
  );
  assert.equal(password.status, 401);
  assert.equal(((await password.json()) as { message: string }).message, "Invalid email or password");

  const otherForbidden = await withClearerOriginError(
    Response.json({ message: "Invalid callbackURL", code: "INVALID_CALLBACK_URL" }, { status: 403 }),
  );
  assert.equal(((await otherForbidden.json()) as { message: string }).message, "Invalid callbackURL");

  const text = await withClearerOriginError(new Response("Invalid origin", { status: 403, headers: { "content-type": "text/plain" } }));
  assert.equal(await text.text(), "Invalid origin");
});
