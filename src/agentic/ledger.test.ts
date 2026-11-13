import assert from "node:assert/strict";
import test from "node:test";
import { effectLedgerSql, ledgerResultText, pickLedgerOwner } from "./ledger";

test("the effect ledger uses the Prisma owner column when user_id is absent", () => {
  const owner = pickLedgerOwner(["key", "userId", "result", "createdAt"]);
  assert.equal(owner, '"userId"');
  const sql = effectLedgerSql(owner);
  assert.match(sql.get, /"userId"/);
  assert.equal(sql.get.includes("user_id"), false);
  assert.match(sql.put, /"userId"/);
  assert.equal(ledgerResultText({ content: "sent" }), "sent");
});

test("the effect ledger keeps user_id when that is the real column", () => {
  const sql = effectLedgerSql(pickLedgerOwner(["key", "user_id", "result"]));
  assert.match(sql.get, /user_id/);
  assert.equal(sql.get.includes('"userId"'), false);
});
