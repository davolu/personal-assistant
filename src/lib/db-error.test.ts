import assert from "node:assert/strict";
import { test } from "node:test";
import { connectionListSelect, databaseProblem } from "./db-error";

test("databaseProblem explains a missing column or table", () => {
  assert.match(databaseProblem({ code: "P2022" }) ?? "", /prisma db push/);
  assert.match(databaseProblem({ code: "P2021" }) ?? "", /prisma db push/);
  assert.match(databaseProblem(new Error('The column `scopes` does not exist in the current database.')) ?? "", /prisma db push/);
});

test("databaseProblem explains an unreachable database and ignores unrelated errors", () => {
  assert.match(databaseProblem({ code: "P1001" }) ?? "", /DATABASE_URL/);
  assert.match(databaseProblem(new Error("Environment variable not found: DATABASE_URL")) ?? "", /DATABASE_URL/);
  assert.equal(databaseProblem(new Error("Cannot read properties of undefined")), null);
  assert.equal(databaseProblem("nope"), null);
});

test("connection list select does not require the new scopes column", () => {
  assert.equal("scopes" in connectionListSelect, false);
  assert.equal(connectionListSelect.toolkit, true);
  assert.equal(connectionListSelect.status, true);
});
